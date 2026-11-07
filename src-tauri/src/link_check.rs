//! Dead-link checker: asks each bookmarked website whether the page still exists.
//!
//! Results are deliberately cautious. Only answers that clearly mean "gone" (HTTP 404/410,
//! a domain that no longer resolves, a refused connection) count as broken; anything that
//! may be temporary or a bot block (403, 429, 5xx, timeouts, TLS trouble) is "uncertain".

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::blocking::{Client, Response};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};

use crate::bookmarks::normalize_url;

const MAX_PARALLEL: usize = 12;
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkCheckTarget {
    pub id: String,
    pub url: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LinkStatus {
    /// The page answered normally.
    Ok,
    /// The page works but now lives at a different address.
    Redirected,
    /// The page or site is gone.
    Broken,
    /// Could not tell for sure (blocked, rate-limited, server error, timeout...).
    Uncertain,
    /// Not a web link (javascript:, file:, chrome:, ...), not checked.
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkCheckResult {
    pub id: String,
    pub url: String,
    pub status: LinkStatus,
    /// HTTP status code, or 0 when no HTTP answer was received.
    pub http_status: u16,
    pub final_url: String,
    pub message: String,
}

pub fn build_client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .connect_timeout(timeout.min(Duration::from_secs(8)))
        .redirect(Policy::limited(10))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to create HTTP client: {e}"))
}

/// Checks all targets, `MAX_PARALLEL` at a time. Results keep the input order.
pub fn check_links(targets: &[LinkCheckTarget], timeout: Duration) -> Result<Vec<LinkCheckResult>, String> {
    let client = build_client(timeout)?;
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Option<LinkCheckResult>>> = Mutex::new(vec![None; targets.len()]);

    std::thread::scope(|scope| {
        for _ in 0..MAX_PARALLEL.min(targets.len()) {
            scope.spawn(|| loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                let Some(target) = targets.get(index) else {
                    break;
                };
                let result = check_one(&client, target);
                if let Ok(mut slots) = results.lock() {
                    slots[index] = Some(result);
                }
            });
        }
    });

    let slots = results.into_inner().map_err(|_| "link check worker panicked".to_string())?;
    Ok(slots
        .into_iter()
        .zip(targets)
        .map(|(slot, target)| {
            slot.unwrap_or_else(|| outcome(target, LinkStatus::Uncertain, 0, "", "Check did not finish"))
        })
        .collect())
}

fn outcome(target: &LinkCheckTarget, status: LinkStatus, http_status: u16, final_url: &str, message: &str) -> LinkCheckResult {
    LinkCheckResult {
        id: target.id.clone(),
        url: target.url.clone(),
        status,
        http_status,
        final_url: final_url.to_string(),
        message: message.to_string(),
    }
}

fn is_web_url(url: &str) -> bool {
    let lower = url.trim_start().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

pub fn check_one(client: &Client, target: &LinkCheckTarget) -> LinkCheckResult {
    let url = target.url.trim();
    if !is_web_url(url) {
        return outcome(target, LinkStatus::Skipped, 0, "", "Not a web link");
    }

    // HEAD is cheap, but many servers answer it wrongly (405, 403, even 404),
    // so anything other than success is confirmed with a real GET.
    let response = match client.head(url).send() {
        Ok(resp) if resp.status().is_success() => Ok(resp),
        _ => client.get(url).send(),
    };

    match response {
        Ok(resp) => classify_response(target, &resp),
        Err(err) => classify_error(target, &err),
    }
}

fn classify_response(target: &LinkCheckTarget, resp: &Response) -> LinkCheckResult {
    let code = resp.status().as_u16();
    let final_url = resp.url().as_str();
    let (status, message) = classify_status(code);
    if status == LinkStatus::Ok && moved_elsewhere(&target.url, final_url) {
        return outcome(target, LinkStatus::Redirected, code, final_url, "Now redirects to another address");
    }
    let final_url = if final_url == target.url { "" } else { final_url };
    outcome(target, status, code, final_url, &message)
}

pub fn classify_status(code: u16) -> (LinkStatus, String) {
    match code {
        200..=399 => (LinkStatus::Ok, String::new()),
        404 => (LinkStatus::Broken, "Page not found (404)".to_string()),
        410 => (LinkStatus::Broken, "Page removed (410)".to_string()),
        401 | 403 => (LinkStatus::Uncertain, format!("Access denied ({code}), the site may block automatic checks")),
        429 => (LinkStatus::Uncertain, "Too many requests (429), try again later".to_string()),
        500..=599 => (LinkStatus::Uncertain, format!("Server error ({code})")),
        _ => (LinkStatus::Uncertain, format!("Unexpected answer ({code})")),
    }
}

/// True when the page now lives somewhere meaningfully different. Not reported:
/// http -> https, a trailing slash, host letter case, adding/removing `www.`, and
/// redirects on the same site from the home page (e.g. to `/it/`) or to a sub-page
/// of the bookmarked address. Those are routine and the bookmark still works.
pub fn moved_elsewhere(original: &str, final_url: &str) -> bool {
    let canonical = |url: &str| {
        let normalized = normalize_url(url);
        normalized.strip_prefix("http://").map(|rest| format!("https://{rest}")).unwrap_or(normalized)
    };
    if canonical(original) == canonical(final_url) {
        return false;
    }
    let (Ok(from), Ok(to)) = (reqwest::Url::parse(original.trim()), reqwest::Url::parse(final_url)) else {
        return true;
    };
    let site = |url: &reqwest::Url| url.host_str().unwrap_or("").trim_start_matches("www.").to_ascii_lowercase();
    if site(&from) != site(&to) {
        return true;
    }
    let from_path = from.path().trim_end_matches('/');
    let from_is_home = from_path.is_empty() && from.query().is_none();
    let to_is_below = to.path().starts_with(from_path)
        && (from_path.is_empty() || to.path()[from_path.len()..].is_empty() || to.path()[from_path.len()..].starts_with('/'));
    !(from_is_home || (to_is_below && from.query() == to.query()))
}

fn classify_error(target: &LinkCheckTarget, err: &reqwest::Error) -> LinkCheckResult {
    let detail = error_chain(err).to_ascii_lowercase();
    if err.is_timeout() {
        return outcome(target, LinkStatus::Uncertain, 0, "", "No answer in time (timeout)");
    }
    if detail.contains("dns") || detail.contains("resolve") || detail.contains("no such host") || detail.contains("name or service not known") {
        return outcome(target, LinkStatus::Broken, 0, "", "Domain no longer exists");
    }
    if detail.contains("certificate") || detail.contains("tls") || detail.contains("ssl") {
        return outcome(target, LinkStatus::Uncertain, 0, "", "Security certificate problem");
    }
    if err.is_redirect() {
        return outcome(target, LinkStatus::Uncertain, 0, "", "Too many redirects");
    }
    if err.is_connect() {
        return outcome(target, LinkStatus::Broken, 0, "", "Site unreachable (connection refused)");
    }
    outcome(target, LinkStatus::Uncertain, 0, "", "Could not check this link")
}

fn error_chain(err: &dyn std::error::Error) -> String {
    let mut text = err.to_string();
    let mut source = err.source();
    while let Some(inner) = source {
        text.push_str(": ");
        text.push_str(&inner.to_string());
        source = inner.source();
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Tiny HTTP server: answers by path, and treats HEAD like the routes say.
    fn serve(routes: fn(&str, &str) -> String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let mut parts = request.split_whitespace();
                let method = parts.next().unwrap_or("").to_string();
                let path = parts.next().unwrap_or("").to_string();
                let _ = stream.write_all(routes(&method, &path).as_bytes());
            }
        });
        format!("http://{addr}")
    }

    fn reply(status: &str, extra: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n{extra}\r\n")
    }

    fn target(url: String) -> LinkCheckTarget {
        LinkCheckTarget { id: url.clone(), url }
    }

    #[test]
    fn classifies_live_dead_blocked_and_moved_pages() {
        let base = serve(|method, path| match (method, path) {
            (_, "/ok") => reply("200 OK", ""),
            (_, "/gone") => reply("404 Not Found", ""),
            ("HEAD", "/no-head") => reply("405 Method Not Allowed", ""),
            ("GET", "/no-head") => reply("200 OK", ""),
            (_, "/blocked") => reply("403 Forbidden", ""),
            (_, "/old") => reply("301 Moved Permanently", "Location: /new\r\n"),
            (_, "/new") => reply("200 OK", ""),
            (_, "/slash") => reply("301 Moved Permanently", "Location: /slash/\r\n"),
            (_, "/slash/") => reply("200 OK", ""),
            _ => reply("500 Internal Server Error", ""),
        });
        let urls = ["/ok", "/gone", "/no-head", "/blocked", "/old", "/slash", "/boom"];
        let targets: Vec<_> = urls.iter().map(|p| target(format!("{base}{p}"))).collect();
        let results = check_links(&targets, Duration::from_secs(5)).unwrap();
        let statuses: Vec<_> = results.iter().map(|r| r.status).collect();
        assert_eq!(
            statuses,
            vec![
                LinkStatus::Ok,
                LinkStatus::Broken,
                LinkStatus::Ok,
                LinkStatus::Uncertain,
                LinkStatus::Redirected,
                LinkStatus::Ok,
                LinkStatus::Uncertain,
            ]
        );
        assert_eq!(results[1].http_status, 404);
        assert_eq!(results[4].final_url, format!("{base}/new"));
        assert_eq!(results.iter().map(|r| r.id.clone()).collect::<Vec<_>>(), targets.iter().map(|t| t.id.clone()).collect::<Vec<_>>());
    }

    #[test]
    fn refused_connection_is_broken_and_non_web_links_are_skipped() {
        // Bind then drop to get a local port nobody listens on.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let results = check_links(
            &[
                target(format!("http://127.0.0.1:{port}/")),
                target("javascript:alert(1)".to_string()),
                target("file:///C:/x.html".to_string()),
            ],
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(results[0].status, LinkStatus::Broken);
        assert_eq!(results[1].status, LinkStatus::Skipped);
        assert_eq!(results[2].status, LinkStatus::Skipped);
    }

    #[test]
    fn status_codes_are_classified_cautiously() {
        assert_eq!(classify_status(204).0, LinkStatus::Ok);
        assert_eq!(classify_status(410).0, LinkStatus::Broken);
        assert_eq!(classify_status(429).0, LinkStatus::Uncertain);
        assert_eq!(classify_status(503).0, LinkStatus::Uncertain);
        assert_eq!(classify_status(400).0, LinkStatus::Uncertain);
    }

    #[test]
    fn https_upgrade_and_trailing_slash_are_not_moves() {
        assert!(!moved_elsewhere("http://Example.com", "https://example.com/"));
        assert!(moved_elsewhere("https://example.com/a", "https://example.com/login"));
        assert!(moved_elsewhere("https://old.example", "https://new.example/"));
        // Routine same-site redirects are not moves.
        assert!(!moved_elsewhere("https://www.rust-lang.org/", "https://www.rust-lang.org/it"));
        assert!(!moved_elsewhere("https://example.com", "https://www.example.com/home"));
        assert!(!moved_elsewhere("https://example.com/docs", "https://example.com/docs/intro"));
        // A different page on the same site still is.
        assert!(moved_elsewhere("https://example.com/docs", "https://example.com/docsearch"));
        assert!(moved_elsewhere("https://example.com/item?id=1", "https://example.com/item?id=2"));
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Needs internet: `cargo test --lib live_ -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_real_site_and_missing_domain() {
        let targets = vec![
            LinkCheckTarget { id: "a".into(), url: "https://www.rust-lang.org/".into() },
            LinkCheckTarget { id: "b".into(), url: "https://this-domain-does-not-exist-7f3a9c.com/".into() },
            LinkCheckTarget { id: "c".into(), url: "https://www.rust-lang.org/this-page-does-not-exist-123".into() },
        ];
        let results = check_links(&targets, Duration::from_secs(12)).unwrap();
        for r in &results {
            println!("{:?} {} {} {}", r.status, r.http_status, r.url, r.message);
        }
        assert_eq!(results[0].status, LinkStatus::Ok);
        assert_eq!(results[1].status, LinkStatus::Broken);
        assert_eq!(results[2].status, LinkStatus::Broken);
    }
}
