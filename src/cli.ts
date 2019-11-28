#!/usr/bin/env ts-node

import Conf from "conf";
import chalk from "chalk";
import Table from "cli-table";
import Ocokit, { UsersGetByUsernameResponse } from "@octokit/rest";

type User = UsersGetByUsernameResponse;

interface Row {
  status: string;
  login: string;
  repos: number;
  followers: number;
  followees: number;
  impact: number;
  url: string;
}

interface Relations {
  followers: Set<string>;
  followees: Set<string>;
}

function cacheForRelations() {
  return new Conf({ configName: "relationsCache" });
}

async function getFollowers(auth: string) {
  const cache = cacheForRelations();
  const cachedFollowers = cache.get("followers");
  if (
    !cachedFollowers ||
    Date.now() - cachedFollowers.lastUpdate > 60 * 60 * 1000
  ) {
    const github = new Ocokit({ auth });
    const options = github.users.listFollowersForAuthenticatedUser.endpoint.merge(
      { per_page: 100 }
    );
    let followers: string[] = [];
    for await (const res of github.paginate.iterator(options)) {
      for (const user of res.data) {
        followers.push(user.login);
      }
    }

    cache.set("followers", {
      lastUpdate: Date.now(),
      data: followers
    });
    return followers;
  }
  return cachedFollowers.data;
}

async function getFollowees(auth: string) {
  const cache = cacheForRelations();
  const cachedFollowees = cache.get("followees");
  if (
    !cachedFollowees ||
    Date.now() - cachedFollowees.lastUpdate > 60 * 60 * 1000
  ) {
    const github = new Ocokit({ auth });
    const options = github.users.listFollowingForAuthenticatedUser.endpoint.merge(
      { per_page: 100 }
    );
    let followees: string[] = [];
    for await (const res of github.paginate.iterator(options)) {
      for (const user of res.data) {
        followees.push(user.login);
      }
    }

    cache.set("followees", {
      lastUpdate: Date.now(),
      data: followees
    });
    return followees;
  }
  return cachedFollowees.data;
}

async function getRelations(auth: string): Promise<Relations> {
  return {
    followers: new Set(await getFollowers(auth)),
    followees: new Set(await getFollowees(auth))
  };
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

async function main(args: string[]): Promise<void> {
  const token = process.env["GITHUB_TOKEN"];
  if (token === undefined) {
    throw new Error("Missing GITHUB_TOKEN");
  }

  const { followers, followees } = await getRelations(token);
  const mutuals = [...followees].filter(username => followers.has(username));
  const watching = [...followees].filter(username => !followers.has(username));
  const watcher = [...followers].filter(username => !followees.has(username));

  console.log(`followees: ${followees.size}`);
  console.log(`followers: ${followers.size}`);
  console.log(`mutuals: ${mutuals.length}`);
  console.log(`watching: ${watching.length}`);
  console.log(`watchers: ${watcher.length}`);

  let watchingResult = await Promise.all(
    watching.map<Promise<Row>>(async username => {
      const profile = await getUser(username, token);
      const followerCount = profile.followers;
      const followeesCount = profile.following;
      return {
        status: chalk.green("watching"),
        login: profile.login,
        repos: profile.public_repos,
        followees: followeesCount,
        followers: followerCount,
        impact: (followerCount + 0.0001) / (followeesCount + 0.0001),
        url: profile.html_url
      };
    })
  );
  watchingResult = watchingResult.sort((a, b) => b.impact - a.impact);

  let watcherResult = await Promise.all(
    watcher.map<Promise<Row>>(async username => {
      const profile = await getUser(username, token);
      const followerCount = profile.followers;
      const followeesCount = profile.following;
      return {
        status: chalk.magenta("watcher"),
        login: profile.login,
        repos: profile.public_repos,
        followees: followeesCount,
        followers: followerCount,
        impact: (followerCount + 0.0001) / (followeesCount + 0.0001),
        url: profile.html_url
      };
    })
  );
  watcherResult = watcherResult.sort((a, b) => b.impact - a.impact);

  const table = new Table({
    head: Object.keys(watchingResult[0])
  });
  table.push(...watchingResult.map(user => Object.values(user)));
  table.push(...watcherResult.map(user => Object.values(user)));
  console.log(table.toString());
}

main(process.argv.slice(2));
