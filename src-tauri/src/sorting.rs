//! Sorting a folder's contents. Sorts are stable, so items that compare equal keep
//! their current relative order.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

use crate::bookmarks::find_node_mut;
use crate::models::Node;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SortMode {
    NameAsc,
    NameDesc,
    DateNewest,
    DateOldest,
    Domain,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SortOptions {
    pub mode: SortMode,
    pub folders_first: bool,
    pub recursive: bool,
}

pub fn sort_folder(tree: &mut [Node], folder_id: &str, options: SortOptions) -> Result<(), String> {
    let node = find_node_mut(tree, folder_id).ok_or_else(|| "node not found".to_string())?;
    let folder = node.folder.as_mut().ok_or_else(|| "only folders can be sorted".to_string())?;
    sort_children(&mut folder.children, options);
    Ok(())
}

fn sort_children(children: &mut [Node], options: SortOptions) {
    children.sort_by(|a, b| compare_nodes(a, b, options));
    if options.recursive {
        for child in children.iter_mut() {
            if let Some(folder) = child.folder.as_mut() {
                sort_children(&mut folder.children, options);
            }
        }
    }
}

fn compare_nodes(a: &Node, b: &Node, options: SortOptions) -> Ordering {
    if options.folders_first {
        let by_kind = b.folder.is_some().cmp(&a.folder.is_some());
        if by_kind != Ordering::Equal {
            return by_kind;
        }
    }
    match options.mode {
        SortMode::NameAsc => natural_cmp(&display_name(a), &display_name(b)),
        SortMode::NameDesc => natural_cmp(&display_name(b), &display_name(a)),
        SortMode::DateNewest => compare_dates(a, b, true),
        SortMode::DateOldest => compare_dates(a, b, false),
        SortMode::Domain => domain(a)
            .cmp(&domain(b))
            .then_with(|| natural_cmp(&display_name(a), &display_name(b))),
    }
}

fn display_name(node: &Node) -> String {
    if let Some(folder) = &node.folder {
        return folder.name.to_lowercase();
    }
    if let Some(bookmark) = &node.bookmark {
        let name = if bookmark.title.trim().is_empty() { &bookmark.url } else { &bookmark.title };
        return name.to_lowercase();
    }
    String::new()
}

/// RFC 3339 dates in the same format sort correctly as text. Missing dates (and the
/// `0001-01-01` placeholder) always go last.
fn compare_dates(a: &Node, b: &Node, newest_first: bool) -> Ordering {
    let date = |node: &Node| -> Option<String> {
        let value = node
            .folder
            .as_ref()
            .map(|f| f.add_date.clone())
            .or_else(|| node.bookmark.as_ref().map(|b| b.add_date.clone()))
            .unwrap_or_default();
        (!value.is_empty() && !value.starts_with("0001-01-01")).then_some(value)
    };
    match (date(a), date(b)) {
        (Some(x), Some(y)) => {
            if newest_first {
                y.cmp(&x)
            } else {
                x.cmp(&y)
            }
        }
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

/// Website host without `www.`; folders and non-web links sort after websites.
fn domain(node: &Node) -> (bool, String) {
    let Some(bookmark) = &node.bookmark else {
        return (true, String::new());
    };
    match reqwest::Url::parse(bookmark.url.trim()).ok().and_then(|u| u.host_str().map(str::to_ascii_lowercase)) {
        Some(host) => (false, host.trim_start_matches("www.").to_string()),
        None => (true, bookmark.url.to_lowercase()),
    }
}

/// Compares text so that digit runs compare by value: "item 2" < "item 10".
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut left = a.chars().peekable();
    let mut right = b.chars().peekable();
    loop {
        match (left.peek().copied(), right.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take_number = |chars: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut digits = String::new();
                    while let Some(c) = chars.peek().copied().filter(char::is_ascii_digit) {
                        digits.push(c);
                        chars.next();
                    }
                    digits
                };
                let (nx, ny) = (take_number(&mut left), take_number(&mut right));
                let (tx, ty) = (nx.trim_start_matches('0'), ny.trim_start_matches('0'));
                let order = tx.len().cmp(&ty.len()).then_with(|| tx.cmp(ty));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(x), Some(y)) => {
                if x != y {
                    return x.cmp(&y);
                }
                left.next();
                right.next();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bm(id: &str, title: &str, url: &str, date: &str) -> Node {
        let mut node = Node::bookmark(id, title, url);
        node.bookmark.as_mut().unwrap().add_date = date.to_string();
        node
    }

    fn folder(id: &str, name: &str, children: Vec<Node>) -> Node {
        let mut node = Node::folder(id, name);
        node.folder.as_mut().unwrap().children = children;
        node
    }

    fn ids(nodes: &[Node]) -> Vec<&str> {
        nodes.iter().map(|n| n.id.as_str()).collect()
    }

    fn children<'a>(tree: &'a [Node], id: &str) -> &'a [Node] {
        &crate::bookmarks::find_node(tree, id).unwrap().folder.as_ref().unwrap().children
    }

    fn opts(mode: SortMode, folders_first: bool, recursive: bool) -> SortOptions {
        SortOptions { mode, folders_first, recursive }
    }

    fn sample() -> Vec<Node> {
        vec![folder(
            "root",
            "Root",
            vec![
                bm("c", "chapter 10", "https://www.zeta.example/a", "2024-03-01T00:00:00Z"),
                folder("sub", "Sub", vec![bm("s2", "b", "https://b.example", ""), bm("s1", "a", "https://a.example", "")]),
                bm("a", "Chapter 2", "https://alpha.example", "2023-01-01T00:00:00Z"),
                bm("b", "", "https://beta.example", ""),
            ],
        )]
    }

    #[test]
    fn natural_order_compares_numbers_by_value() {
        assert_eq!(natural_cmp("chapter 2", "chapter 10"), Ordering::Less);
        assert_eq!(natural_cmp("a02", "a2"), Ordering::Equal);
        assert_eq!(natural_cmp("abc", "abd"), Ordering::Less);
        assert_eq!(natural_cmp("ab", "abc"), Ordering::Less);
    }

    #[test]
    fn sorts_by_name_with_folders_first_and_url_fallback() {
        let mut tree = sample();
        sort_folder(&mut tree, "root", opts(SortMode::NameAsc, true, false)).unwrap();
        // "b" has no title, so its URL "https://beta..." is used as its name.
        assert_eq!(ids(children(&tree, "root")), vec!["sub", "a", "c", "b"]);
        // Not recursive: the subfolder is untouched.
        assert_eq!(ids(children(&tree, "sub")), vec!["s2", "s1"]);
    }

    #[test]
    fn sorts_descending_and_recursively_without_folders_first() {
        let mut tree = sample();
        sort_folder(&mut tree, "root", opts(SortMode::NameDesc, false, true)).unwrap();
        assert_eq!(ids(children(&tree, "root")), vec!["sub", "b", "c", "a"]);
        assert_eq!(ids(children(&tree, "sub")), vec!["s2", "s1"]);
    }

    #[test]
    fn sorts_by_date_with_missing_dates_last() {
        let mut tree = sample();
        sort_folder(&mut tree, "root", opts(SortMode::DateNewest, false, false)).unwrap();
        assert_eq!(ids(children(&tree, "root")), vec!["c", "a", "sub", "b"]);
        sort_folder(&mut tree, "root", opts(SortMode::DateOldest, false, false)).unwrap();
        assert_eq!(ids(children(&tree, "root")), vec!["a", "c", "sub", "b"]);
    }

    #[test]
    fn sorts_by_domain_ignoring_www_and_putting_folders_after() {
        let mut tree = sample();
        sort_folder(&mut tree, "root", opts(SortMode::Domain, false, false)).unwrap();
        assert_eq!(ids(children(&tree, "root")), vec!["a", "b", "c", "sub"]);
    }

    #[test]
    fn refuses_bookmarks_and_unknown_ids() {
        let mut tree = sample();
        assert!(sort_folder(&mut tree, "a", opts(SortMode::NameAsc, true, false)).is_err());
        assert!(sort_folder(&mut tree, "nope", opts(SortMode::NameAsc, true, false)).is_err());
    }
}
