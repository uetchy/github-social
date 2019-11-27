#!/usr/bin/env ts-node
import fs from "fs";
import Conf from "conf";
import Table from "cli-table";
import Ocokit, { UsersGetByUsernameResponse } from "@octokit/rest";

type User = UsersGetByUsernameResponse;

interface Row {
  login: string;
  repos: number;
  following: number;
  followers: number;
  ratio: number;
  url: string;
}

interface Relations {
  followers: Set<string>;
  followings: Set<string>;
}

async function getCachedFF(auth: string): Promise<Relations> {
  try {
    const { followers, followings } = JSON.parse(
      fs.readFileSync("cache.json", "utf-8")
    );
    return {
      followers: new Set(followers),
      followings: new Set(followings)
    };
  } catch (err) {
    const github = new Ocokit({ auth });
    const followersOptions = github.users.listFollowersForAuthenticatedUser.endpoint.merge(
      { per_page: 100 }
    );
    let followers: string[] = [];
    for await (const res of github.paginate.iterator(followersOptions)) {
      for (const user of res.data) {
        followers.push(user.login);
      }
    }

    const followingOptions = github.users.listFollowingForAuthenticatedUser.endpoint.merge(
      { per_page: 100 }
    );
    let followings: string[] = [];
    for await (const res of github.paginate.iterator(followingOptions)) {
      for (const user of res.data) {
        followings.push(user.login);
      }
    }

    fs.writeFileSync("cache.json", JSON.stringify({ followers, followings }));

    return {
      followers: new Set(followers),
      followings: new Set(followings)
    };
  }
}

async function getUser(username: string, auth: string): Promise<User> {
  const userCache = new Conf({ configName: "userCache" });
  const user =
    (userCache.get(username) as User) ??
    (await (async () => {
      console.log(`Not in cache: ${username}`);
      const github = new Ocokit({ auth });
      const user = (await github.users.getByUsername({ username })).data;
      userCache.set(user.login, user);
      return user;
    })());
  return user;
}

async function printTable(userNames: string[], auth: string): Promise<void> {
  let result = await Promise.all(
    userNames.map<Promise<Row>>(async username => {
      const profile = await getUser(username, auth);
      const followerCount = profile.followers;
      const followingCount = profile.following;
      return {
        login: profile.login,
        repos: profile.public_repos,
        following: followingCount,
        followers: followerCount,
        ratio: (followerCount + 0.0001) / (followingCount + 0.0001),
        url: profile.html_url
      };
    })
  );
  result = result.sort((a, b) => b.ratio - a.ratio);
  const table = new Table({
    head: Object.keys(result[0])
  });
  table.push(...result.map(user => Object.values(user)));
  console.log(table.toString());
}

async function main(args: string[]): Promise<void> {
  const token = process.env["GITHUB_TOKEN"];
  if (token === undefined) {
    throw new Error("Missing GITHUB_TOKEN");
  }

  const { followers, followings } = await getCachedFF(token);

  const mutuals = [...followings].filter(username => followers.has(username));
  const watching = [...followings].filter(username => !followers.has(username));
  const nofollow = [...followers].filter(username => !followings.has(username));

  console.log(`followings: ${followings.size}`);
  console.log(`followers: ${followers.size}`);
  console.log(`mutuals: ${mutuals.length}`);
  console.log(`watching: ${watching.length}`);
  console.log(`no-follow: ${nofollow.length}`);

  console.log("# Watching users");
  await printTable(watching, token);
  console.log("# One-sided followers");
  await printTable(nofollow, token);
}

main(process.argv.slice(2));
