use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::dto::{
    BookmarkConflictItem, BookmarkCreateDto, BookmarkMergeItem, DuplicateGroup, DuplicateItem,
    FolderMergeItem, MergeApplyResult,
    MergePreview, MoveResult, NodeDto, TreeStats,
};
use crate::models::{Bookmark, BookmarkIndexEntry, BookmarkPatch, FlatNode, Node, NodeType};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct SnapshotCommand {
    pub label: String,
    pub before: Vec<Node>,
    pub after: Vec<Node>,
}

pub fn generate_id() -> String {
    format!("node-{}", ID_COUNTER.fetch_add(1, Ordering::Relaxed))
}

pub fn current_timestamp() -> String {
    // Minimal UTC RFC3339 formatting without extra dependencies.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    unix_to_rfc3339(secs)
}

fn unix_to_rfc3339(secs: i64) -> String {
    // UTC-only conversion adapted to avoid chrono/time dependencies.
    const SECS_PER_DAY: i64 = 86_400;
    let days = secs.div_euclid(SECS_PER_DAY);
    let seconds_of_day = secs.rem_euclid(SECS_PER_DAY);

    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3600;
    let minute = (seconds_of_day % 3600) / 60;
    let second = seconds_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn rfc3339_to_unix(value: &str) -> Option<i64> {
    if value.is_empty() {
        return None;
    }
    let bytes = value.as_bytes();
    if bytes.len() < 20 {
        return None;
    }
    let year: i32 = value.get(0..4)?.parse().ok()?;
    let month: u32 = value.get(5..7)?.parse().ok()?;
    let day: u32 = value.get(8..10)?.parse().ok()?;
    let hour: u32 = value.get(11..13)?.parse().ok()?;
    let minute: u32 = value.get(14..16)?.parse().ok()?;
    let second: u32 = value.get(17..19)?.parse().ok()?;
    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + i64::from(hour) * 3600 + i64::from(minute) * 60 + i64::from(second))
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = month as i32;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era as i64 * 146097 + doe as i64 - 719468
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i32 + era as i32 * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + if m <= 2 { 1 } else { 0 }, m as u32, d as u32)
}

fn parse_html_timestamp(value: &str) -> String {
    value
        .parse::<i64>()
        .ok()
        .map(unix_to_rfc3339)
        .unwrap_or_default()
}

fn html_timestamp_attr(value: &str) -> Option<i64> {
    rfc3339_to_unix(value)
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Decodes HTML character references in a single pass: numeric (`&#39;`, `&#x27;`)
/// and the named entities that browsers actually emit in bookmark exports.
/// Anything unrecognised is left verbatim, so odd input never loses characters.
fn unescape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let after = &rest[amp + 1..];
        // Entity names/numbers are short; cap the search so a stray '&' stays cheap.
        let semi = after.char_indices().take(12).find(|&(_, c)| c == ';').map(|(i, _)| i);
        match semi.and_then(|semi| decode_entity(&after[..semi]).map(|ch| (semi, ch))) {
            Some((semi, ch)) => {
                out.push(ch);
                rest = &after[semi + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn decode_entity(entity: &str) -> Option<char> {
    if let Some(num) = entity.strip_prefix('#') {
        let code = match num.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok()?,
            None => num.parse::<u32>().ok()?,
        };
        // NUL is replaced like browsers do; invalid code points are rejected.
        return if code == 0 { Some('\u{FFFD}') } else { char::from_u32(code) };
    }
    Some(match entity {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => '\u{00A0}',
        "ndash" => '–',
        "mdash" => '—',
        "hellip" => '…',
        "laquo" => '«',
        "raquo" => '»',
        "lsquo" => '‘',
        "rsquo" => '’',
        "ldquo" => '“',
        "rdquo" => '”',
        "middot" => '·',
        "bull" => '•',
        "copy" => '©',
        "reg" => '®',
        "trade" => '™',
        "euro" => '€',
        "deg" => '°',
        "times" => '×',
        _ => return None,
    })
}

pub fn load_file(path: &str) -> Result<Vec<Node>, String> {
    let data = fs::read_to_string(path).map_err(|e| format!("failed to read file: {e}"))?;
    parse_bookmarks_html(&data)
}

/// Backups live in this folder next to the bookmark file.
pub const BACKUP_DIR_NAME: &str = ".zeromarks-backups";
/// Number of backups kept per bookmark file; older ones are deleted.
const BACKUP_KEEP: usize = 20;
/// A new backup is taken only if the newest one is at least this old,
/// so a burst of edits does not fill the folder with near-identical copies.
const BACKUP_MIN_INTERVAL_SECS: i64 = 10 * 60;

pub fn save_file(path: &str, tree: &[Node]) -> Result<(), String> {
    save_file_with_backup(path, tree, false)
}

/// `force_backup` skips the 10-minute throttle: used when the file on disk was changed
/// by another program, so that version is always kept before we overwrite it.
pub fn save_file_with_backup(path: &str, tree: &[Node], force_backup: bool) -> Result<(), String> {
    let path = Path::new(path);
    let now = unix_now();
    let backup = if force_backup { force_backup_file(path, now) } else { backup_existing_file(path, now) };
    if let Err(err) = backup {
        // A failed backup must never block saving the user's edit.
        eprintln!("zeromarks: backup skipped: {err}");
    }
    write_atomic(path, serialize_bookmarks_html(tree).as_bytes())
        .map_err(|e| format!("failed to save bookmarks: {e}"))
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Writes to a temporary file in the same folder, flushes it to disk, then swaps it in,
/// so a crash mid-save leaves the previous file intact instead of a truncated one.
fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    let file_name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    let mut tmp_name = OsString::from(".");
    tmp_name.push(file_name);
    tmp_name.push(".tmp");
    let tmp_path = path.with_file_name(tmp_name);

    let written = (|| -> io::Result<()> {
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(data)?;
        file.sync_all()
    })();
    if let Err(err) = written {
        let _ = fs::remove_file(&tmp_path);
        return Err(err);
    }
    if let Err(err) = fs::rename(&tmp_path, path) {
        // Rename can fail on Windows when another program (e.g. a sync client) holds the
        // target open. Fall back to a direct write rather than losing the edit.
        let _ = fs::remove_file(&tmp_path);
        eprintln!("zeromarks: atomic rename failed ({err}), writing in place");
        fs::write(path, data)?;
    }
    Ok(())
}

pub fn backup_dir_for(path: &Path) -> PathBuf {
    path.parent().unwrap_or_else(|| Path::new("")).join(BACKUP_DIR_NAME)
}

/// Copies the current on-disk file into the backup folder (if it exists and the newest
/// backup is old enough), then prunes old backups. Returns the new backup's path, if any.
/// Hash of the file's bytes, or `None` if it cannot be read (missing, locked...).
/// Used to notice when another program changed the bookmark file.
pub fn disk_fingerprint(path: &str) -> Option<u64> {
    use std::hash::{Hash, Hasher};
    if path.is_empty() {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    Some(hasher.finish())
}

/// Backs up the current on-disk file right now, ignoring the throttle.
pub fn backup_now(path: &str) -> io::Result<Option<PathBuf>> {
    force_backup_file(Path::new(path), unix_now())
}

fn force_backup_file(path: &Path, now: i64) -> io::Result<Option<PathBuf>> {
    backup_existing_file_inner(path, now, true)
}

fn backup_existing_file(path: &Path, now: i64) -> io::Result<Option<PathBuf>> {
    backup_existing_file_inner(path, now, false)
}

fn backup_existing_file_inner(path: &Path, now: i64, force: bool) -> io::Result<Option<PathBuf>> {
    if !path.is_file() {
        return Ok(None);
    }
    let dir = backup_dir_for(path);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "bookmarks".to_string());
    let prefix = format!("{stem}-");
    let mut backups = list_backups(&dir, &prefix)?;

    if let Some((newest, _)) = backups.last() {
        let age = now - newest;
        if !force && (0..BACKUP_MIN_INTERVAL_SECS).contains(&age) {
            return Ok(None);
        }
    }

    fs::create_dir_all(&dir)?;
    let target = dir.join(format!("{prefix}{}.html", backup_stamp(now)));
    fs::copy(path, &target)?;
    backups.push((now, target.clone()));
    backups.sort();

    let excess = backups.len().saturating_sub(BACKUP_KEEP);
    for (_, old) in backups.iter().take(excess) {
        if *old != target {
            let _ = fs::remove_file(old);
        }
    }
    Ok(Some(target))
}

/// Backups of `<stem>.html` are named `<stem>-YYYYMMDD-HHMMSS.html` (UTC).
/// Returns them oldest first, paired with their timestamp.
fn list_backups(dir: &Path, prefix: &str) -> io::Result<Vec<(i64, PathBuf)>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    let mut backups = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let stamp = name.strip_prefix(prefix).and_then(|rest| rest.strip_suffix(".html"));
        if let Some(secs) = stamp.and_then(parse_backup_stamp) {
            backups.push((secs, entry.path()));
        }
    }
    backups.sort();
    Ok(backups)
}

fn backup_stamp(secs: i64) -> String {
    // "2026-10-31T14:53:00Z" -> "20261031-145300"
    let rfc = unix_to_rfc3339(secs);
    let digits: String = rfc.chars().filter(char::is_ascii_digit).collect();
    format!("{}-{}", &digits[..8], &digits[8..14])
}

fn parse_backup_stamp(stamp: &str) -> Option<i64> {
    let bytes = stamp.as_bytes();
    if bytes.len() != 15 || bytes[8] != b'-' {
        return None;
    }
    if !bytes.iter().enumerate().all(|(i, b)| i == 8 || b.is_ascii_digit()) {
        return None;
    }
    let rfc = format!(
        "{}-{}-{}T{}:{}:{}Z",
        &stamp[0..4],
        &stamp[4..6],
        &stamp[6..8],
        &stamp[9..11],
        &stamp[11..13],
        &stamp[13..15]
    );
    rfc3339_to_unix(&rfc)
}

pub fn parse_bookmarks_html(data: &str) -> Result<Vec<Node>, String> {
    if !data.to_ascii_lowercase().contains("<dl") {
        return Err("no bookmark data found (missing root <DL>)".to_string());
    }

    let lines: Vec<String> = data.lines().map(|line| line.trim().to_string()).collect();
    let mut index = 0usize;
    while index < lines.len() && !lines[index].to_ascii_lowercase().starts_with("<dl") {
        index += 1;
    }
    if index == lines.len() {
        return Err("no bookmark data found (missing root <DL>)".to_string());
    }
    index += 1;
    parse_dl_lines(&lines, &mut index)
}

const BOOKMARK_KNOWN_ATTRS: &[&str] = &["href", "add_date", "last_modified", "icon", "icon_uri", "iconuri", "meta"];
const FOLDER_KNOWN_ATTRS: &[&str] = &["add_date", "last_modified", "icon", "meta"];

type Attrs = Vec<(String, String)>;

fn attr<'a>(attrs: &'a Attrs, key: &str) -> Option<&'a String> {
    attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

fn extra_attrs(attrs: &Attrs, known: &[&str]) -> Attrs {
    attrs
        .iter()
        .filter(|(k, _)| !known.contains(&k.as_str()))
        .cloned()
        .collect()
}

fn skip_blank_lines(lines: &[String], index: &mut usize) {
    while *index < lines.len() && lines[*index].trim().is_empty() {
        *index += 1;
    }
}

/// Consumes an optional `<DD>` description (which may span several lines) and returns its text.
fn take_description(lines: &[String], index: &mut usize) -> String {
    skip_blank_lines(lines, index);
    if *index >= lines.len() || !lines[*index].to_ascii_lowercase().starts_with("<dd>") {
        return String::new();
    }
    let mut parts = vec![lines[*index][4..].to_string()];
    *index += 1;
    while *index < lines.len() {
        let lower = lines[*index].to_ascii_lowercase();
        if ["<dt", "<dl", "</dl", "<dd", "<hr"].iter().any(|tag| lower.starts_with(tag)) {
            break;
        }
        parts.push(lines[*index].clone());
        *index += 1;
    }
    unescape_html(parts.join("\n").trim())
}

fn parse_dl_lines(lines: &[String], index: &mut usize) -> Result<Vec<Node>, String> {
    let mut nodes = Vec::new();
    while *index < lines.len() {
        let line = lines[*index].trim();
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("</dl") {
            *index += 1;
            break;
        }
        if lower.starts_with("<dt><h3") {
            let (tag_block, next_index) = collect_tag_block(lines, *index, "h3")?;
            let (attrs, name) = parse_tag(&tag_block, "h3")?;
            *index = next_index;
            let description = take_description(lines, index);
            skip_blank_lines(lines, index);
            let mut children = Vec::new();
            if *index < lines.len() && lines[*index].trim().to_ascii_lowercase().starts_with("<dl") {
                *index += 1;
                children = parse_dl_lines(lines, index)?;
            }
            let mut folder = Node::folder(generate_id(), unescape_html(&name));
            if let Some(f) = folder.folder.as_mut() {
                f.add_date = attr(&attrs, "add_date").map(|v| parse_html_timestamp(v)).unwrap_or_default();
                f.last_modified = attr(&attrs, "last_modified")
                    .map(|v| parse_html_timestamp(v))
                    .unwrap_or_default();
                f.icon = attr(&attrs, "icon").cloned().unwrap_or_default();
                f.meta = attr(&attrs, "meta").cloned().unwrap_or_default();
                f.description = description;
                f.extra_attrs = extra_attrs(&attrs, FOLDER_KNOWN_ATTRS);
                f.children = children;
            }
            nodes.push(folder);
            continue;
        }
        if lower.starts_with("<dt><a") {
            let (tag_block, next_index) = collect_tag_block(lines, *index, "a")?;
            let (attrs, title) = parse_tag(&tag_block, "a")?;
            *index = next_index;
            let mut bookmark = Node::bookmark(
                generate_id(),
                unescape_html(&title),
                attr(&attrs, "href").cloned().unwrap_or_default(),
            );
            if let Some(b) = bookmark.bookmark.as_mut() {
                b.add_date = attr(&attrs, "add_date").map(|v| parse_html_timestamp(v)).unwrap_or_default();
                b.last_modified = attr(&attrs, "last_modified")
                    .map(|v| parse_html_timestamp(v))
                    .unwrap_or_default();
                b.icon = attr(&attrs, "icon").cloned().unwrap_or_default();
                b.icon_uri = attr(&attrs, "icon_uri")
                    .or_else(|| attr(&attrs, "iconuri"))
                    .cloned()
                    .unwrap_or_default();
                b.meta = attr(&attrs, "meta").cloned().unwrap_or_default();
                b.description = take_description(lines, index);
                b.extra_attrs = extra_attrs(&attrs, BOOKMARK_KNOWN_ATTRS);
            }
            nodes.push(bookmark);
            continue;
        }
        *index += 1;
    }
    Ok(nodes)
}

fn collect_tag_block(lines: &[String], start_index: usize, tag: &str) -> Result<(String, usize), String> {
    let close = format!("</{tag}>");
    let mut block = String::new();
    let mut index = start_index;
    while index < lines.len() {
        if !block.is_empty() {
            block.push('\n');
        }
        block.push_str(lines[index].trim());
        index += 1;
        if block.to_ascii_lowercase().contains(&close) {
            return Ok((block, index));
        }
    }
    Err(format!("missing </{tag}>"))
}

fn parse_tag(line: &str, tag: &str) -> Result<(Attrs, String), String> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let start = line.to_ascii_lowercase().find(&open).ok_or_else(|| format!("missing <{tag}>"))?;
    let gt = find_tag_end(line, start + open.len())
        // Unbalanced quotes: fall back to the first `>` rather than rejecting the whole file.
        .or_else(|| line[start..].find('>').map(|offset| start + offset))
        .ok_or_else(|| "unterminated tag".to_string())?;
    let end = line.to_ascii_lowercase().rfind(&close).ok_or_else(|| format!("missing </{tag}>"))?;
    if end < gt {
        return Err(format!("malformed <{tag}> tag"));
    }
    let attr_src = &line[start + open.len()..gt];
    let inner = &line[gt + 1..end];
    Ok((parse_attrs(attr_src), inner.to_string()))
}

/// Finds the `>` that closes an opening tag, ignoring any `>` inside quoted attribute values.
fn find_tag_end(line: &str, from: usize) -> Option<usize> {
    let mut quote: Option<u8> = None;
    for (offset, &byte) in line.as_bytes()[from..].iter().enumerate() {
        match quote {
            Some(q) if byte == q => quote = None,
            Some(_) => {}
            None if byte == b'"' || byte == b'\'' => quote = Some(byte),
            None if byte == b'>' => return Some(from + offset),
            None => {}
        }
    }
    None
}

fn parse_attrs(src: &str) -> Attrs {
    let mut attrs = Attrs::new();
    let bytes = src.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let key_start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'=' {
            i += 1;
        }
        let key = src[key_start..i].to_ascii_lowercase();
        let mut j = i;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        let value = if j < bytes.len() && bytes[j] == b'=' {
            j += 1;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < bytes.len() && (bytes[j] == b'"' || bytes[j] == b'\'') {
                let quote = bytes[j];
                j += 1;
                let value_start = j;
                while j < bytes.len() && bytes[j] != quote {
                    j += 1;
                }
                let value = &src[value_start..j];
                if j < bytes.len() {
                    j += 1;
                }
                value
            } else {
                let value_start = j;
                while j < bytes.len() && !bytes[j].is_ascii_whitespace() {
                    j += 1;
                }
                &src[value_start..j]
            }
        } else {
            // Attribute without a value: leave the following whitespace for the next key.
            j = i;
            ""
        };
        i = j;
        if !key.is_empty() && attr(&attrs, &key).is_none() {
            attrs.push((key, unescape_html(value)));
        }
    }
    attrs
}

pub fn serialize_bookmarks_html(nodes: &[Node]) -> String {
    let mut out = String::from(
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n",
    );
    write_dl(&mut out, nodes, 0);
    out
}

fn write_dl(out: &mut String, nodes: &[Node], indent: usize) {
    write_indent(out, indent);
    out.push_str("<DL><p>\n");
    for node in nodes {
        match node.node_type {
            x if x == NodeType::Folder as u8 => write_folder(out, node, indent + 1),
            x if x == NodeType::Bookmark as u8 => write_bookmark(out, node, indent + 1),
            _ => {}
        }
    }
    write_indent(out, indent);
    out.push_str("</DL><p>\n");
}

fn write_folder(out: &mut String, node: &Node, indent: usize) {
    let Some(folder) = &node.folder else { return };
    write_indent(out, indent);
    out.push_str("<DT><H3");
    write_time_attr(out, "ADD_DATE", &folder.add_date);
    write_time_attr(out, "LAST_MODIFIED", &folder.last_modified);
    write_string_attr(out, "ICON", &folder.icon);
    write_string_attr(out, "META", &folder.meta);
    write_extra_attrs(out, &folder.extra_attrs);
    out.push('>');
    out.push_str(&escape_html(&folder.name));
    out.push_str("</H3>\n");
    write_description(out, &folder.description, indent);
    write_dl(out, &folder.children, indent + 1);
}

fn write_bookmark(out: &mut String, node: &Node, indent: usize) {
    let Some(bookmark) = &node.bookmark else { return };
    write_indent(out, indent);
    out.push_str("<DT><A");
    write_string_attr(out, "HREF", &bookmark.url);
    write_time_attr(out, "ADD_DATE", &bookmark.add_date);
    write_time_attr(out, "LAST_MODIFIED", &bookmark.last_modified);
    write_string_attr(out, "ICON", &bookmark.icon);
    write_string_attr(out, "ICON_URI", &bookmark.icon_uri);
    write_string_attr(out, "META", &bookmark.meta);
    write_extra_attrs(out, &bookmark.extra_attrs);
    out.push('>');
    out.push_str(&escape_html(&bookmark.title));
    out.push_str("</A>\n");
    write_description(out, &bookmark.description, indent);
}

fn write_extra_attrs(out: &mut String, attrs: &[(String, String)]) {
    for (key, value) in attrs {
        // Written even when empty so value-less attributes survive a save.
        out.push_str(&format!(" {}=\"{}\"", key.to_ascii_uppercase(), escape_html(value)));
    }
}

fn write_description(out: &mut String, description: &str, indent: usize) {
    if description.is_empty() {
        return;
    }
    write_indent(out, indent);
    out.push_str("<DD>");
    out.push_str(&escape_html(description));
    out.push('\n');
}

fn write_indent(out: &mut String, indent: usize) {
    for _ in 0..indent {
        out.push_str("    ");
    }
}

fn write_string_attr(out: &mut String, key: &str, value: &str) {
    if !value.is_empty() {
        out.push_str(&format!(" {key}=\"{}\"", escape_html(value)));
    }
}

fn write_time_attr(out: &mut String, key: &str, value: &str) {
    if let Some(unix) = html_timestamp_attr(value) {
        out.push_str(&format!(" {key}=\"{unix}\""));
    }
}

pub fn flatten_tree(nodes: &[Node]) -> Vec<FlatNode> {
    let mut result = Vec::new();
    flatten_into(nodes, "", &mut result);
    result
}

fn flatten_into(nodes: &[Node], parent_id: &str, result: &mut Vec<FlatNode>) {
    for node in nodes {
        result.push(new_flat_node(node, parent_id));
        if let Some(folder) = &node.folder {
            flatten_into(&folder.children, &folder.id, result);
        }
    }
}

pub fn new_flat_node(node: &Node, parent_id: &str) -> FlatNode {
    match (&node.folder, &node.bookmark) {
        (Some(folder), None) => FlatNode {
            id: folder.id.clone(),
            node_type: NodeType::Folder as u8,
            parent_id: parent_id.to_string(),
            name: folder.name.clone(),
            icon: folder.icon.clone(),
            add_date: folder.add_date.clone(),
            last_modified: folder.last_modified.clone(),
            meta: folder.meta.clone(),
            child_count: folder.children.len() as i32,
            ..FlatNode::default()
        },
        (None, Some(bookmark)) => FlatNode {
            id: bookmark.id.clone(),
            node_type: NodeType::Bookmark as u8,
            parent_id: parent_id.to_string(),
            name: bookmark.title.clone(),
            url: bookmark.url.clone(),
            icon: bookmark.icon.clone(),
            icon_uri: bookmark.icon_uri.clone(),
            add_date: bookmark.add_date.clone(),
            last_modified: bookmark.last_modified.clone(),
            meta: bookmark.meta.clone(),
            child_count: 0,
        },
        _ => FlatNode::default(),
    }
}

pub fn build_flat_index(nodes: &[Node]) -> Vec<BookmarkIndexEntry> {
    let mut result = Vec::new();
    build_flat_index_into(nodes, "", &mut result);
    result
}

fn build_flat_index_into(nodes: &[Node], path: &str, result: &mut Vec<BookmarkIndexEntry>) {
    for node in nodes {
        if let Some(bookmark) = &node.bookmark {
            result.push(BookmarkIndexEntry {
                node_id: bookmark.id.clone(),
                title: bookmark.title.clone(),
                url: bookmark.url.clone(),
                folder_path: path.to_string(),
            });
        } else if let Some(folder) = &node.folder {
            let next_path = if path.is_empty() {
                folder.name.clone()
            } else {
                format!("{path} / {}", folder.name)
            };
            build_flat_index_into(&folder.children, &next_path, result);
        }
    }
}

pub fn collect_folder_nodes(nodes: &[Node]) -> Vec<NodeDto> {
    let mut result = Vec::new();
    collect_folders_into(nodes, &mut result);
    result
}

fn collect_folders_into(nodes: &[Node], result: &mut Vec<NodeDto>) {
    for node in nodes {
        if let Some(folder) = &node.folder {
            result.push(NodeDto::from(node.clone()));
            collect_folders_into(&folder.children, result);
        }
    }
}

pub fn tree_stats(nodes: &[Node]) -> TreeStats {
    let mut stats = TreeStats::default();
    count_nodes(nodes, &mut stats);
    stats
}

fn count_nodes(nodes: &[Node], stats: &mut TreeStats) {
    for node in nodes {
        if let Some(folder) = &node.folder {
            stats.folders += 1;
            count_nodes(&folder.children, stats);
        } else if node.bookmark.is_some() {
            stats.bookmarks += 1;
        }
    }
}

pub fn add_bookmark(tree: &mut Vec<Node>, parent_id: &str, input: BookmarkCreateDto) -> Result<FlatNode, String> {
    let mut bookmark = Bookmark::default();
    bookmark.id = generate_id();
    bookmark.title = input.title;
    bookmark.url = input.url;
    bookmark.icon = input.icon;
    bookmark.icon_uri = input.icon_uri;
    bookmark.meta = input.meta;
    bookmark.add_date = current_timestamp();
    bookmark.last_modified = current_timestamp();
    let node = Node::bookmark(bookmark.id.clone(), bookmark.title.clone(), bookmark.url.clone());
    let mut created = node.clone();
    created.bookmark = Some(bookmark);
    insert_node(tree, parent_id, created.clone())?;
    Ok(new_flat_node(&created, parent_id))
}

pub fn add_folder(tree: &mut Vec<Node>, parent_id: &str, name: &str) -> Result<FlatNode, String> {
    let mut folder = Node::folder(generate_id(), name.to_string());
    if let Some(f) = folder.folder.as_mut() {
        f.add_date = current_timestamp();
        f.last_modified = current_timestamp();
    }
    insert_node(tree, parent_id, folder.clone())?;
    Ok(new_flat_node(&folder, parent_id))
}

fn insert_node(tree: &mut Vec<Node>, parent_id: &str, node: Node) -> Result<(), String> {
    if parent_id.is_empty() {
        tree.push(node);
        return Ok(());
    }
    let Some(parent) = find_node_mut(tree, parent_id) else {
        return Err("node not found".to_string());
    };
    let Some(folder) = parent.folder.as_mut() else {
        return Err("cannot move into a bookmark (only folders)".to_string());
    };
    folder.children.push(node);
    Ok(())
}

pub fn update_bookmark(tree: &mut [Node], id: &str, patch: BookmarkPatch) -> Result<(), String> {
    let Some(node) = find_node_mut(tree, id) else {
        return Err("node not found".to_string());
    };
    let Some(bookmark) = node.bookmark.as_mut() else {
        return Err("node is not a bookmark".to_string());
    };
    if let Some(title) = patch.title { bookmark.title = title; }
    if let Some(url) = patch.url { bookmark.url = url; }
    if let Some(icon) = patch.icon { bookmark.icon = icon; }
    if let Some(icon_uri) = patch.icon_uri { bookmark.icon_uri = icon_uri; }
    if let Some(meta) = patch.meta { bookmark.meta = meta; }
    bookmark.last_modified = current_timestamp();
    Ok(())
}

pub fn update_folder_name(tree: &mut [Node], id: &str, name: &str) -> Result<(), String> {
    let Some(node) = find_node_mut(tree, id) else {
        return Err("node not found".to_string());
    };
    let Some(folder) = node.folder.as_mut() else {
        return Err("node is not a folder".to_string());
    };
    folder.name = name.to_string();
    folder.last_modified = current_timestamp();
    Ok(())
}

pub fn delete_node(tree: &mut Vec<Node>, id: &str) -> Result<(), String> {
    if remove_node(tree, id).is_some() {
        Ok(())
    } else {
        Err("node not found".to_string())
    }
}

pub fn delete_nodes(tree: &mut Vec<Node>, ids: &[String]) -> Result<(), String> {
    for id in ids {
        if !contains_node(tree, id) {
            return Err("node not found".to_string());
        }
    }
    let id_set: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
    filter_out_nodes(tree, &id_set);
    Ok(())
}

fn filter_out_nodes(nodes: &mut Vec<Node>, ids: &std::collections::HashSet<&str>) {
    nodes.retain(|node| !ids.contains(node.id.as_str()));
    for node in nodes {
        if let Some(folder) = node.folder.as_mut() {
            filter_out_nodes(&mut folder.children, ids);
        }
    }
}

pub fn move_node(tree: &mut Vec<Node>, node_id: &str, new_parent_id: &str, new_index: i32) -> Result<MoveResult, String> {
    if node_id == new_parent_id {
        return Err("cannot move folder into its own descendant".to_string());
    }
    if is_descendant(tree, node_id, new_parent_id) {
        return Err("cannot move folder into its own descendant".to_string());
    }
    ensure_folder_target(tree, new_parent_id)?;
    let old_parent_id = find_parent_id(tree, node_id).unwrap_or_default();
    let removed = remove_node(tree, node_id).ok_or_else(|| "node not found".to_string())?;
    let insert_parent_id = new_parent_id.to_string();
    let actual_new_index = insert_at(tree, &insert_parent_id, new_index, removed.clone())?;
    Ok(MoveResult {
        moved_nodes: vec![new_flat_node(&removed, &insert_parent_id)],
        old_parent_id,
        new_parent_id: insert_parent_id,
        new_index: actual_new_index,
    })
}

pub fn move_nodes(tree: &mut Vec<Node>, node_ids: &[String], target_folder_id: &str) -> Result<MoveResult, String> {
    ensure_folder_target(tree, target_folder_id)?;
    for id in node_ids {
        if !contains_node(tree, id) {
            return Err("node not found".to_string());
        }
        if id == target_folder_id || is_descendant(tree, id, target_folder_id) {
            return Err("cannot move folder into its own descendant".to_string());
        }
    }

    let mut moved = Vec::new();
    let old_parent_id = node_ids
        .first()
        .and_then(|id| find_parent_id(tree, id))
        .unwrap_or_default();
    for id in node_ids {
        let removed = remove_node(tree, id).ok_or_else(|| "node not found".to_string())?;
        moved.push(removed);
    }
    let Some(target) = find_node_mut(tree, target_folder_id) else {
        return Err("node not found".to_string());
    };
    let Some(folder) = target.folder.as_mut() else {
        return Err("cannot move into a bookmark (only folders)".to_string());
    };
    let mut flat = Vec::new();
    for node in moved {
        flat.push(new_flat_node(&node, target_folder_id));
        folder.children.push(node);
    }
    Ok(MoveResult {
        moved_nodes: flat,
        old_parent_id,
        new_parent_id: target_folder_id.to_string(),
        new_index: folder.children.len() as i32,
    })
}

fn insert_at(tree: &mut Vec<Node>, parent_id: &str, new_index: i32, node: Node) -> Result<i32, String> {
    if parent_id.is_empty() {
        let idx = new_index.clamp(0, tree.len() as i32) as usize;
        tree.insert(idx, node);
        return Ok(idx as i32);
    }
    let Some(parent) = find_node_mut(tree, parent_id) else {
        return Err("node not found".to_string());
    };
    let Some(folder) = parent.folder.as_mut() else {
        return Err("cannot move into a bookmark (only folders)".to_string());
    };
    let idx = new_index.clamp(0, folder.children.len() as i32) as usize;
    folder.children.insert(idx, node);
    Ok(idx as i32)
}

fn ensure_folder_target(tree: &[Node], parent_id: &str) -> Result<(), String> {
    if parent_id.is_empty() {
        return Ok(());
    }

    let Some(parent) = find_node(tree, parent_id) else {
        return Err("node not found".to_string());
    };
    if parent.folder.is_none() {
        return Err("cannot move into a bookmark (only folders)".to_string());
    }

    Ok(())
}

pub fn preview_merge(existing: &[Node], incoming: &[Node]) -> MergePreview {
    let mut preview = MergePreview::default();
    let mut index = UrlIndex::build(existing);
    preview_nodes(Some(existing), incoming, &mut Vec::new(), &mut index, &mut preview);
    preview.folders_to_add.sort_by(|a, b| a.path.cmp(&b.path));
    preview.bookmarks_to_add.sort_by(compare_bookmark_items);
    preview.duplicate_bookmarks.sort_by(compare_bookmark_items);
    preview.potential_updates.sort_by(|a, b| {
        a.folder_path
            .cmp(&b.folder_path)
            .then(a.incoming_title.cmp(&b.incoming_title))
            .then(a.url.cmp(&b.url))
    });
    preview
}

fn compare_bookmark_items(a: &BookmarkMergeItem, b: &BookmarkMergeItem) -> std::cmp::Ordering {
    a.folder_path.cmp(&b.folder_path).then(a.title.cmp(&b.title)).then(a.url.cmp(&b.url))
}

/// `existing` is the matching folder's children in the current tree, or `None` when the
/// incoming folder is new (everything below it will be added).
fn preview_nodes(
    existing: Option<&[Node]>,
    incoming: &[Node],
    path: &mut Vec<String>,
    index: &mut UrlIndex,
    preview: &mut MergePreview,
) {
    for node in incoming {
        if let Some(folder) = &node.folder {
            path.push(folder.name.clone());
            let existing_folder = existing.and_then(|nodes| {
                nodes.iter().find_map(|n| n.folder.as_ref().filter(|f| f.name == folder.name))
            });
            if existing_folder.is_none() {
                preview.folders_to_add.push(FolderMergeItem {
                    path: path.join(" / "),
                    name: folder.name.clone(),
                });
            }
            preview_nodes(existing_folder.map(|f| f.children.as_slice()), &folder.children, path, index, preview);
            path.pop();
        } else if let Some(bookmark) = &node.bookmark {
            let folder_path = path.join(" / ");
            let item = BookmarkMergeItem {
                folder_path: folder_path.clone(),
                title: bookmark.title.clone(),
                url: bookmark.url.clone(),
            };
            let is_new = match index.classify(bookmark) {
                MergeMatch::Duplicate => {
                    preview.duplicate_bookmarks.push(item);
                    false
                }
                MergeMatch::PotentialUpdate(found) => {
                    preview.potential_updates.push(BookmarkConflictItem {
                        folder_path: folder_path.clone(),
                        existing_folder_path: found.folder_path.clone(),
                        existing_title: found.bookmark.title.clone(),
                        incoming_title: bookmark.title.clone(),
                        url: bookmark.url.clone(),
                        existing_meta: found.bookmark.meta.clone(),
                        incoming_meta: bookmark.meta.clone(),
                    });
                    false
                }
                MergeMatch::None => {
                    preview.bookmarks_to_add.push(item);
                    true
                }
            };
            if is_new {
                // Same bookkeeping as apply_merge, so a link repeated inside the
                // imported file is reported once as an add and then as a duplicate.
                index.insert("", &folder_path, bookmark);
            }
        }
    }
}

enum MergeMatch<'a> {
    None,
    Duplicate,
    PotentialUpdate(&'a IndexedBookmark),
}

struct IndexedBookmark {
    id: String,
    folder_path: String,
    bookmark: Bookmark,
}

/// Every bookmark in the library keyed by normalised URL, so an import recognises a
/// link that already exists even when the user has moved it to a different folder.
struct UrlIndex {
    entries: HashMap<String, Vec<IndexedBookmark>>,
}

impl UrlIndex {
    fn build(tree: &[Node]) -> Self {
        let mut index = Self { entries: HashMap::new() };
        index.add_tree(tree, &mut Vec::new());
        index
    }

    fn add_tree(&mut self, nodes: &[Node], path: &mut Vec<String>) {
        for node in nodes {
            if let Some(folder) = &node.folder {
                path.push(folder.name.clone());
                self.add_tree(&folder.children, path);
                path.pop();
            } else if let Some(bookmark) = &node.bookmark {
                self.insert(&node.id, &path.join(" / "), bookmark);
            }
        }
    }

    fn insert(&mut self, id: &str, folder_path: &str, bookmark: &Bookmark) {
        let key = normalize_url(&bookmark.url);
        if key.is_empty() {
            return;
        }
        self.entries.entry(key).or_default().push(IndexedBookmark {
            id: id.to_string(),
            folder_path: folder_path.to_string(),
            bookmark: bookmark.clone(),
        });
    }

    fn classify(&self, incoming: &Bookmark) -> MergeMatch<'_> {
        let Some(matches) = self.entries.get(&normalize_url(&incoming.url)) else {
            return MergeMatch::None;
        };
        if matches.iter().any(|m| same_bookmark_content(&m.bookmark, incoming)) {
            return MergeMatch::Duplicate;
        }
        matches.first().map_or(MergeMatch::None, MergeMatch::PotentialUpdate)
    }
}

fn same_bookmark_content(a: &Bookmark, b: &Bookmark) -> bool {
    a.title == b.title && a.meta == b.meta && a.icon == b.icon && a.icon_uri == b.icon_uri
}

/// Conservative URL key: lower-cases scheme and host and ignores a trailing `/` on the
/// path. Query strings and fragments are kept as-is, since they often matter.
pub(crate) fn normalize_url(url: &str) -> String {
    let url = url.trim();
    let tail_start = url.find(['?', '#']).unwrap_or(url.len());
    let (base, tail) = url.split_at(tail_start);
    let Some(scheme_end) = base.find("://") else {
        return url.to_string();
    };
    let scheme = base[..scheme_end].to_ascii_lowercase();
    let rest = &base[scheme_end + 3..];
    let (host, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
    let path = path.strip_suffix('/').unwrap_or(path);
    format!("{scheme}://{}{path}{tail}", host.to_ascii_lowercase())
}

/// Groups bookmarks that point to the same link (same normalised URL as the import
/// uses). Groups come in library order; within a group, copies are in tree order.
pub fn find_duplicates(tree: &[Node]) -> Vec<DuplicateGroup> {
    let index = UrlIndex::build(tree);
    let order = flatten_bookmark_order(tree);
    let mut groups: Vec<(usize, DuplicateGroup)> = index
        .entries
        .into_values()
        .filter(|copies| copies.len() > 1)
        .map(|copies| {
            let first = copies.iter().filter_map(|c| order.get(&c.id)).min().copied().unwrap_or(usize::MAX);
            let mut items: Vec<DuplicateItem> = copies
                .into_iter()
                .map(|c| DuplicateItem {
                    id: c.id,
                    title: c.bookmark.title,
                    url: c.bookmark.url,
                    folder_path: c.folder_path,
                    add_date: c.bookmark.add_date,
                })
                .collect();
            items.sort_by_key(|item| order.get(&item.id).copied().unwrap_or(usize::MAX));
            let url = items[0].url.clone();
            (first, DuplicateGroup { url, items })
        })
        .collect();
    groups.sort_by_key(|(first, _)| *first);
    groups.into_iter().map(|(_, group)| group).collect()
}

fn flatten_bookmark_order(tree: &[Node]) -> HashMap<String, usize> {
    fn visit(nodes: &[Node], order: &mut HashMap<String, usize>) {
        for node in nodes {
            if let Some(folder) = &node.folder {
                visit(&folder.children, order);
            } else if node.bookmark.is_some() {
                let next = order.len();
                order.insert(node.id.clone(), next);
            }
        }
    }
    let mut order = HashMap::new();
    visit(tree, &mut order);
    order
}

/// Copies details the existing bookmark lacks (icon, description, add date, extra
/// attributes such as TAGS) from an imported copy of the same link. Never overwrites
/// anything already set, so titles and edits made in this app are always kept.
fn fill_missing_details(existing: &mut Bookmark, incoming: &Bookmark) -> bool {
    let mut changed = false;
    if existing.icon.is_empty() && existing.icon_uri.is_empty() && !(incoming.icon.is_empty() && incoming.icon_uri.is_empty()) {
        existing.icon = incoming.icon.clone();
        existing.icon_uri = incoming.icon_uri.clone();
        changed = true;
    }
    if existing.description.is_empty() && !incoming.description.is_empty() {
        existing.description = incoming.description.clone();
        changed = true;
    }
    if existing.add_date.is_empty() && !incoming.add_date.is_empty() {
        existing.add_date = incoming.add_date.clone();
        changed = true;
    }
    for (key, value) in &incoming.extra_attrs {
        if !existing.extra_attrs.iter().any(|(k, _)| k == key) {
            existing.extra_attrs.push((key.clone(), value.clone()));
            changed = true;
        }
    }
    changed
}

pub fn apply_merge(existing: &mut Vec<Node>, incoming: &[Node]) -> MergeApplyResult {
    let mut result = MergeApplyResult::default();
    let mut index = UrlIndex::build(existing);
    let mut updates = Vec::new();
    merge_nodes(existing, incoming, &mut Vec::new(), &mut index, &mut updates, &mut result);
    for (id, incoming_bookmark) in updates {
        if let Some(bookmark) = find_node_mut(existing, &id).and_then(|n| n.bookmark.as_mut()) {
            if fill_missing_details(bookmark, &incoming_bookmark) {
                result.bookmarks_updated += 1;
            }
        }
    }
    result
}

fn merge_nodes(
    existing: &mut Vec<Node>,
    incoming: &[Node],
    path: &mut Vec<String>,
    index: &mut UrlIndex,
    updates: &mut Vec<(String, Bookmark)>,
    result: &mut MergeApplyResult,
) {
    for node in incoming {
        if let Some(folder) = &node.folder {
            path.push(folder.name.clone());
            let idx = existing.iter().position(|n| n.folder.as_ref().map(|f| f.name.as_str()) == Some(folder.name.as_str()));
            let index_in_parent = match idx {
                Some(index_in_parent) => index_in_parent,
                None => {
                    let mut cloned = Node::folder(generate_id(), folder.name.clone());
                    if let Some(new_folder) = cloned.folder.as_mut() {
                        new_folder.icon = folder.icon.clone();
                        new_folder.meta = folder.meta.clone();
                        new_folder.add_date = folder.add_date.clone();
                        new_folder.last_modified = folder.last_modified.clone();
                        new_folder.description = folder.description.clone();
                        new_folder.extra_attrs = folder.extra_attrs.clone();
                    }
                    existing.push(cloned);
                    result.folders_added += 1;
                    existing.len() - 1
                }
            };
            if let Some(target) = existing[index_in_parent].folder.as_mut() {
                merge_nodes(&mut target.children, &folder.children, path, index, updates, result);
            }
            path.pop();
        } else if let Some(bookmark) = &node.bookmark {
            let is_new = match index.classify(bookmark) {
                MergeMatch::Duplicate => {
                    result.duplicates_skipped += 1;
                    false
                }
                MergeMatch::PotentialUpdate(found) => {
                    result.potential_updates += 1;
                    updates.push((found.id.clone(), bookmark.clone()));
                    false
                }
                MergeMatch::None => true,
            };
            if is_new {
                let mut cloned = Node::bookmark(generate_id(), bookmark.title.clone(), bookmark.url.clone());
                if let Some(new_bookmark) = cloned.bookmark.as_mut() {
                    new_bookmark.icon = bookmark.icon.clone();
                    new_bookmark.icon_uri = bookmark.icon_uri.clone();
                    new_bookmark.meta = bookmark.meta.clone();
                    new_bookmark.add_date = bookmark.add_date.clone();
                    new_bookmark.last_modified = bookmark.last_modified.clone();
                    new_bookmark.description = bookmark.description.clone();
                    new_bookmark.extra_attrs = bookmark.extra_attrs.clone();
                }
                index.insert(&cloned.id, &path.join(" / "), bookmark);
                existing.push(cloned);
                result.bookmarks_added += 1;
            }
        }
    }
}

pub fn find_node_mut<'a>(nodes: &'a mut [Node], id: &str) -> Option<&'a mut Node> {
    for node in nodes {
        if node.id == id {
            return Some(node);
        }
        if let Some(folder) = node.folder.as_mut() {
            if let Some(found) = find_node_mut(&mut folder.children, id) {
                return Some(found);
            }
        }
    }
    None
}

pub fn find_node<'a>(nodes: &'a [Node], id: &str) -> Option<&'a Node> {
    for node in nodes {
        if node.id == id {
            return Some(node);
        }
        if let Some(folder) = &node.folder {
            if let Some(found) = find_node(&folder.children, id) {
                return Some(found);
            }
        }
    }
    None
}

fn contains_node(nodes: &[Node], id: &str) -> bool {
    find_node(nodes, id).is_some()
}

pub fn find_parent_id(nodes: &[Node], child_id: &str) -> Option<String> {
    for node in nodes {
        if let Some(folder) = &node.folder {
            if folder.children.iter().any(|child| child.id == child_id) {
                return Some(folder.id.clone());
            }
            if let Some(found) = find_parent_id(&folder.children, child_id) {
                return Some(found);
            }
        }
    }
    None
}

fn is_descendant(nodes: &[Node], ancestor_id: &str, descendant_id: &str) -> bool {
    let Some(ancestor) = find_node(nodes, ancestor_id) else {
        return false;
    };
    let Some(folder) = &ancestor.folder else {
        return false;
    };
    contains_node(&folder.children, descendant_id)
}

fn remove_node(nodes: &mut Vec<Node>, id: &str) -> Option<Node> {
    if let Some(index) = nodes.iter().position(|node| node.id == id) {
        return Some(nodes.remove(index));
    }
    for node in nodes {
        if let Some(folder) = node.folder.as_mut() {
            if let Some(removed) = remove_node(&mut folder.children, id) {
                return Some(removed);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder_with(id: &str, name: &str, children: Vec<Node>) -> Node {
        let mut node = Node::folder(id, name);
        node.folder.as_mut().unwrap().children = children;
        node
    }

    #[test]
    fn find_duplicates_groups_copies_across_folders_in_tree_order() {
        let tree = vec![
            Node::bookmark("a1", "Alpha", "https://alpha.example/"),
            folder_with("f", "Folder", vec![
                Node::bookmark("b1", "Beta", "https://beta.example"),
                Node::bookmark("a2", "Alpha copy", "HTTPS://ALPHA.example"),
                folder_with("g", "Sub", vec![Node::bookmark("b2", "Beta", "https://beta.example/")]),
            ]),
            Node::bookmark("u1", "Unique", "https://unique.example"),
            Node::bookmark("a3", "Alpha 3", "https://alpha.example"),
        ];
        let groups = find_duplicates(&tree);
        assert_eq!(groups.len(), 2);
        let ids: Vec<Vec<&str>> = groups.iter().map(|g| g.items.iter().map(|i| i.id.as_str()).collect()).collect();
        assert_eq!(ids, vec![vec!["a1", "a2", "a3"], vec!["b1", "b2"]]);
        assert_eq!(groups[0].url, "https://alpha.example/");
        assert_eq!(groups[0].items[1].folder_path, "Folder");
        assert_eq!(groups[1].items[1].folder_path, "Folder / Sub");
        assert!(find_duplicates(&[Node::bookmark("x", "X", "https://x.example")]).is_empty());
    }

    #[test]
    fn normalize_url_is_conservative() {
        assert_eq!(normalize_url("HTTPS://Example.COM/Path/"), "https://example.com/Path");
        assert_eq!(normalize_url("https://example.com"), normalize_url("https://example.com/"));
        assert_eq!(normalize_url(" https://a.example/x/?q=1#Frag "), "https://a.example/x?q=1#Frag");
        assert_ne!(normalize_url("http://a.example"), normalize_url("https://a.example"));
        assert_eq!(normalize_url("javascript:alert(1)"), "javascript:alert(1)");
    }

    #[test]
    fn import_skips_links_that_exist_in_another_folder() {
        let mut existing = vec![folder_with("w", "Work", vec![Node::bookmark("b1", "Docs", "https://docs.example/")])];
        let incoming = vec![
            folder_with("x", "Imported", vec![Node::bookmark("i1", "Docs", "HTTPS://docs.example")]),
            Node::bookmark("i2", "Docs again", "https://docs.example"),
        ];

        let preview = preview_merge(&existing, &incoming);
        assert_eq!(preview.folders_to_add.len(), 1);
        assert!(preview.bookmarks_to_add.is_empty());
        assert_eq!(preview.duplicate_bookmarks.len(), 1);
        assert_eq!(preview.potential_updates.len(), 1);
        assert_eq!(preview.potential_updates[0].existing_folder_path, "Work");
        assert_eq!(preview.potential_updates[0].existing_title, "Docs");

        let result = apply_merge(&mut existing, &incoming);
        assert_eq!(result.bookmarks_added, 0);
        assert_eq!(result.duplicates_skipped, 1);
        assert_eq!(result.potential_updates, 1);
        let imported = existing[1].folder.as_ref().unwrap();
        assert_eq!(imported.name, "Imported");
        assert!(imported.children.is_empty());
    }

    #[test]
    fn import_adds_a_link_repeated_in_the_file_only_once() {
        let mut existing = Vec::new();
        let incoming = vec![
            folder_with("a", "A", vec![Node::bookmark("i1", "Site", "https://site.example")]),
            folder_with("b", "B", vec![Node::bookmark("i2", "Site", "https://site.example/")]),
        ];
        let preview = preview_merge(&existing, &incoming);
        assert_eq!(preview.bookmarks_to_add.len(), 1);
        assert_eq!(preview.duplicate_bookmarks.len(), 1);

        let result = apply_merge(&mut existing, &incoming);
        assert_eq!(result.bookmarks_added, 1);
        assert_eq!(result.duplicates_skipped, 1);
    }

    #[test]
    fn import_fills_missing_details_without_overwriting() {
        let mut existing = vec![Node::bookmark("b1", "My title", "https://news.example")];
        {
            let b = existing[0].bookmark.as_mut().unwrap();
            b.extra_attrs = vec![("shortcuturl".into(), "n".into())];
        }
        let mut incoming_node = Node::bookmark("i1", "Their title", "https://news.example");
        {
            let b = incoming_node.bookmark.as_mut().unwrap();
            b.icon = "data:image/png;base64,AAAA".into();
            b.description = "Daily news".into();
            b.extra_attrs = vec![("shortcuturl".into(), "other".into()), ("tags".into(), "news".into())];
        }

        let result = apply_merge(&mut existing, &[incoming_node]);
        assert_eq!(result.potential_updates, 1);
        assert_eq!(result.bookmarks_updated, 1);
        let b = existing[0].bookmark.as_ref().unwrap();
        assert_eq!(b.title, "My title");
        assert_eq!(b.icon, "data:image/png;base64,AAAA");
        assert_eq!(b.description, "Daily news");
        assert_eq!(
            b.extra_attrs,
            vec![("shortcuturl".to_string(), "n".to_string()), ("tags".to_string(), "news".to_string())]
        );

        // Importing the same file again changes nothing further.
        let again = existing[0].clone();
        let result = apply_merge(&mut existing, &[again]);
        assert_eq!(result.duplicates_skipped, 1);
        assert_eq!(result.bookmarks_updated, 0);
    }

    #[test]
    fn unescape_decodes_numeric_and_named_entities() {
        assert_eq!(unescape_html("Rock &#39;n&#x27; Roll"), "Rock 'n' Roll");
        assert_eq!(unescape_html("A &amp; B &lt;tag&gt; &quot;q&quot; &apos;s"), "A & B <tag> \"q\" 's");
        assert_eq!(unescape_html("caff&#232; &#xE8;&nbsp;&euro; &mdash; &hellip;"), "caffè è\u{00A0}€ — …");
        // Decoding is a single pass: "&amp;lt;" means the literal text "&lt;".
        assert_eq!(unescape_html("&amp;lt;"), "&lt;");
    }

    #[test]
    fn unescape_leaves_unknown_or_malformed_references_alone() {
        assert_eq!(unescape_html("AT&T"), "AT&T");
        assert_eq!(unescape_html("?a=1&b=2"), "?a=1&b=2");
        assert_eq!(unescape_html("&unknown; &#; &#xZZ; &#1114112;"), "&unknown; &#; &#xZZ; &#1114112;");
        assert_eq!(unescape_html("trailing &"), "trailing &");
        assert_eq!(unescape_html("&#0;"), "\u{FFFD}");
    }

    #[test]
    fn chrome_apostrophe_titles_are_decoded_and_round_trip() {
        let html = "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n    <DT><A HREF=\"https://x.example/?q=it&#39;s\">It&#39;s &quot;fine&quot;</A>\n</DL><p>\n";
        let tree = parse_bookmarks_html(html).unwrap();
        let bm = tree[0].bookmark.as_ref().unwrap();
        assert_eq!(bm.title, "It's \"fine\"");
        assert_eq!(bm.url, "https://x.example/?q=it's");

        let reparsed = parse_bookmarks_html(&serialize_bookmarks_html(&tree)).unwrap();
        assert_eq!(reparsed[0].bookmark.as_ref().unwrap().title, "It's \"fine\"");
    }

    #[test]
    fn serialize_round_trip_simple_tree() {
        let mut root = Node::folder("f1", "Folder");
        root.folder.as_mut().unwrap().children.push(Node::bookmark("b1", "Example", "https://example.com"));
        let tree = vec![root];
        let output = serialize_bookmarks_html(&tree);
        let reparsed = parse_bookmarks_html(&output).unwrap();
        assert_eq!(reparsed.len(), 1);
        assert_eq!(reparsed[0].folder.as_ref().unwrap().name, "Folder");
        assert_eq!(reparsed[0].folder.as_ref().unwrap().children[0].bookmark.as_ref().unwrap().title, "Example");
    }

    #[test]
    fn parses_multiline_bookmark_tag_with_meta() {
        let html = r#"<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" LAST_MODIFIED="2">favorites bar!</H3>
    <DL><p>
        <DT><A HREF="https://radarr.hubspar.com" ADD_DATE="3" LAST_MODIFIED="4" META="Radarr is a thing

And stuff">Login - Radarr</A>
    </DL><p>
</DL><p>"#;

        let reparsed = parse_bookmarks_html(html).unwrap();
        let folder = reparsed[0].folder.as_ref().unwrap();
        let bookmark = folder.children[0].bookmark.as_ref().unwrap();
        assert_eq!(bookmark.title, "Login - Radarr");
        assert_eq!(bookmark.url, "https://radarr.hubspar.com");
        assert_eq!(bookmark.meta, "Radarr is a thing\n\nAnd stuff");
    }

    const BROWSER_EXPORT: &str = r#"<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" LAST_MODIFIED="2" PERSONAL_TOOLBAR_FOLDER="true">Toolbar</H3>
    <DD>Folder notes
    <DL><p>
        <DT><A HREF="https://example.com/?a=1&amp;b=2" ADD_DATE="3" SHORTCUTURL="ex" TAGS="news,tech">Example</A>
        <DD>First line
second line
        <DT><A HREF=https://unquoted.example ADD_DATE='4' FEEDURL="">Unquoted</A>
    </DL><p>
</DL><p>
"#;

    #[test]
    fn preserves_unknown_attributes_and_descriptions() {
        let tree = parse_bookmarks_html(BROWSER_EXPORT).unwrap();
        let folder = tree[0].folder.as_ref().unwrap();
        assert_eq!(folder.description, "Folder notes");
        assert_eq!(folder.extra_attrs, vec![("personal_toolbar_folder".to_string(), "true".to_string())]);

        let first = folder.children[0].bookmark.as_ref().unwrap();
        assert_eq!(first.url, "https://example.com/?a=1&b=2");
        assert_eq!(first.description, "First line\nsecond line");
        assert_eq!(
            first.extra_attrs,
            vec![
                ("shortcuturl".to_string(), "ex".to_string()),
                ("tags".to_string(), "news,tech".to_string()),
            ]
        );

        let second = folder.children[1].bookmark.as_ref().unwrap();
        assert_eq!(second.url, "https://unquoted.example");
        assert_eq!(second.add_date, "1970-01-01T00:00:04Z");
        assert_eq!(second.extra_attrs, vec![("feedurl".to_string(), String::new())]);
        assert_eq!(second.description, "");
    }

    #[test]
    fn round_trip_keeps_unknown_attributes_and_descriptions() {
        let tree = parse_bookmarks_html(BROWSER_EXPORT).unwrap();
        let output = serialize_bookmarks_html(&tree);
        assert!(output.contains("PERSONAL_TOOLBAR_FOLDER=\"true\""));
        assert!(output.contains("TAGS=\"news,tech\""));
        assert!(output.contains("<DD>Folder notes"));

        let reparsed = parse_bookmarks_html(&output).unwrap();
        // Ids are regenerated on parse but never written, so output must be identical.
        assert_eq!(serialize_bookmarks_html(&reparsed), output);
        let folder = reparsed[0].folder.as_ref().unwrap();
        assert_eq!(folder.children[0].bookmark.as_ref().unwrap().description, "First line\nsecond line");
    }

    #[test]
    fn tag_end_ignores_greater_than_inside_quotes() {
        let tree = parse_bookmarks_html(
            "<DL><p>\n<DT><A HREF=\"https://x.test\" NOTE=\"a > b\">Title</A>\n</DL><p>",
        )
        .unwrap();
        let bookmark = tree[0].bookmark.as_ref().unwrap();
        assert_eq!(bookmark.title, "Title");
        assert_eq!(bookmark.extra_attrs, vec![("note".to_string(), "a > b".to_string())]);
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zeromarks-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn save_file_writes_atomically_without_leftover_temp_file() {
        let dir = temp_dir("atomic");
        let path = dir.join("bookmarks.html");
        let tree = vec![Node::bookmark("b1", "One", "https://one.test")];
        save_file(path.to_str().unwrap(), &tree).unwrap();
        save_file(path.to_str().unwrap(), &tree).unwrap();

        let names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().all(|n| !n.ends_with(".tmp")), "leftover temp file: {names:?}");
        assert_eq!(parse_bookmarks_html(&fs::read_to_string(&path).unwrap()).unwrap().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn backups_are_throttled_and_pruned() {
        let dir = temp_dir("backups");
        let path = dir.join("bookmarks.html");

        // Nothing to back up before the file exists.
        assert!(backup_existing_file(&path, 1_000_000).unwrap().is_none());

        fs::write(&path, "original").unwrap();
        let first = backup_existing_file(&path, 1_000_000).unwrap().expect("first backup");
        assert_eq!(fs::read_to_string(&first).unwrap(), "original");
        assert!(first.file_name().unwrap().to_string_lossy().starts_with("bookmarks-19700112-"));

        // Within the throttle window: no new backup.
        assert!(backup_existing_file(&path, 1_000_000 + 60).unwrap().is_none());

        // A file whose name merely starts with the same stem is not one of our backups.
        fs::write(backup_dir_for(&path).join("bookmarks-work.html"), "other").unwrap();

        let mut now = 1_000_000;
        for _ in 0..(BACKUP_KEEP + 5) {
            now += BACKUP_MIN_INTERVAL_SECS;
            backup_existing_file(&path, now).unwrap().expect("backup after interval");
        }
        let backups = list_backups(&backup_dir_for(&path), "bookmarks-").unwrap();
        assert_eq!(backups.len(), BACKUP_KEEP);
        assert_eq!(backups.last().unwrap().0, now);
        assert!(backup_dir_for(&path).join("bookmarks-work.html").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_stamp_round_trips() {
        let secs = 1_793_458_380; // 2026-10-31T14:53:00Z
        assert_eq!(backup_stamp(secs), "20261031-145300");
        assert_eq!(parse_backup_stamp("20261031-145300"), Some(secs));
        assert_eq!(parse_backup_stamp("work"), None);
    }

    #[test]
    fn add_and_flatten_bookmark() {
        let mut tree = vec![Node::folder("f1", "Root")];
        let flat = add_bookmark(
            &mut tree,
            "f1",
            BookmarkCreateDto {
                title: "GitHub".into(),
                url: "https://github.com".into(),
                ..BookmarkCreateDto::default()
            },
        )
        .unwrap();
        assert_eq!(flat.parent_id, "f1");
        assert_eq!(flatten_tree(&tree).len(), 2);
    }
}
