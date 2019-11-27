use github_rs::client::{Executor, Github};
use serde::Deserialize;
// use serde_json::Value;
use regex::Regex;
use std::env;
use std::process;

#[derive(Deserialize, Debug)]
struct User {
    login: String,
    id: i32,
    node_id: String,
    avatar_url: String,
    gravatar_id: String,
    url: String,
    html_url: String,
    followers_url: String,
    following_url: String,
    gists_url: String,
    starred_url: String,
    subscriptions_url: String,
    organizations_url: String,
    repos_url: String,
    events_url: String,
    received_events_url: String,
    r#type: String,
    site_admin: bool,
}

fn parse_page(url: &str) -> i32 {
    let re = Regex::new(r"[?&]page=(\d+)").unwrap();
    match re.captures(url) {
        Some(cap) => cap[1].parse::<i32>().unwrap(),
        None => 1,
    }
}

fn parse_link(link: &str) {}

fn main() {
    let token = match env::var("GITHUB_TOKEN") {
        Ok(token) => token,
        Err(err) => {
            println!("{}: {}", err, "GITHUB_TOKEN");
            process::exit(1);
        }
    };
    let client = Github::new(token).unwrap();
    // let me = client.get().user().execute::<Value>();
    let response = client.get().user().followers().execute::<Vec<User>>();
    let followers = match response {
        Ok((_headers, _status, json)) => {
            println!("{:?}", _headers);
            json.expect("Error while parsing JSON")
        }
        Err(e) => {
            println!("{}", e);
            process::exit(1);
        }
    };
    for follower in followers {
        println!("{}", follower.login);
    }
}
