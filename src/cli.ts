#!/usr/bin/env node

import { Octokit } from "@octokit/rest";
import { Endpoints } from "@octokit/types";
import chalk from "chalk";
import Table from "cli-table";
import Conf from "conf";

interface Row {
  status: string;
  login: string;
  repos: number;
  followers: number;
  followings: number;
  impact: number;
  url: string;
}

interface Relations {
  followers: Set<string>;
  followings: Set<string>;
}

type User = Exclude<
  Endpoints["GET /users/{username}/followers"]["response"]["data"][0],
  null
>;

type Schema = {
  followers: {
    lastUpdate: number;
    data: string[];
  };
  followings: {
    lastUpdate: number;
    data: string[];
  };
};

const getConfig = (configName: string) =>
  new Conf<Schema>({
    projectName: "github-social",
    configName,
  });
const cacheForRelations = () => getConfig("relationsCache");
const cacheForUsers = () => getConfig("userCache");

async function getFollowers(auth: string): Promise<string[]> {
  const cache = cacheForRelations();
  const cachedFollowers = cache.get("followers");

  if (
    !cachedFollowers ||
    Date.now() - cachedFollowers.lastUpdate > 60 * 60 * 1000
  ) {
    const github = new Octokit({ auth });

    const options = github.users.listFollowersForAuthenticatedUser.endpoint.merge(
      { per_page: 100 }
    );
    let followers: string[] = [];
    for await (const res of github.paginate.iterator<User>(options)) {
      for (const user of res.data) {
        followers.push(user.login);
      }
    }

    if (cachedFollowers) {
      const newFollowers = difference(
        new Set(followers),
        new Set(cachedFollowers.data)
      );
      const NoLongerFollowed = difference(
        new Set(cachedFollowers.data),
        new Set(followers)
      );
      console.log("new followers:", [...newFollowers].join(', '));
      console.log("no longer followed you:", [...NoLongerFollowed].join(', '));
    }

    cache.set("followers", {
      lastUpdate: Date.now(),
      data: followers,
    });

    return followers;
  }

  return cachedFollowers.data;
}

async function getFollowings(auth: string): Promise<string[]> {
  const cache = cacheForRelations();
  const cachedFollowings = cache.get("followings");

  if (
    !cachedFollowings ||
    Date.now() - cachedFollowings.lastUpdate > 60 * 60 * 1000
  ) {
    const github = new Octokit({ auth });
    const options = github.users.listFollowedByAuthenticated.endpoint.merge({
      per_page: 100,
    });
    let followings: string[] = [];
    for await (const res of github.paginate.iterator<User>(options)) {
      for (const user of res.data) {
        followings.push(user.login);
      }
    }

    cache.set("followings", {
      lastUpdate: Date.now(),
      data: followings,
    });

    return followings;
  }

  return cachedFollowings.data;
}

async function getRelations(auth: string): Promise<Relations> {
  return {
    followers: new Set(await getFollowers(auth)),
    followings: new Set(await getFollowings(auth)),
  };
}

async function getUser(username: string, auth: string) {
  const userCache = cacheForUsers();
  const user =
    (userCache.get(
      username
    ) as Endpoints["GET /users/{username}"]["response"]["data"]) ??
    (await (async () => {
      console.log(`Fetching user profile for ${username}`);
      const github = new Octokit({ auth });
      const user = (await github.users.getByUsername({ username })).data;
      userCache.set(user.login, user);
      return user;
    })());

  return user;
}

async function main(args: string[]): Promise<void> {
  const token = process.env["GITHUB_TOKEN"];
  if (token === undefined) {
    throw new Error("Missing GITHUB_TOKEN env var.");
  }

  const { followers, followings } = await getRelations(token);
  const mutuals = [...followings].filter((username) => followers.has(username));
  const watching = [...followings].filter(
    (username) => !followers.has(username)
  );
  const watcher = [...followers].filter(
    (username) => !followings.has(username)
  );

  console.log(`followings: ${followings.size}`);
  console.log(`followers: ${followers.size}`);
  console.log(`mutuals: ${mutuals.length}`);
  console.log(`watching: ${watching.length}`);
  console.log(`watchers: ${watcher.length}`);

  const watchingResult = (
    await Promise.all(
      watching.map<Promise<Row>>(async (username) => {
        const profile = await getUser(username, token);
        const followerCount = profile.followers;
        const followingsCount = profile.following;
        return {
          status: chalk.green("watching"),
          login: profile.login,
          repos: profile.public_repos,
          followings: followingsCount,
          followers: followerCount,
          impact: calculateImpactFactor(
            followerCount,
            followingsCount,
            profile.public_repos
          ),
          url: profile.html_url,
        };
      })
    )
  ).sort((a, b) => b.impact - a.impact);

  const watcherResult = (
    await Promise.all(
      watcher.map<Promise<Row>>(async (username) => {
        const profile = await getUser(username, token);
        const followerCount = profile.followers;
        const followingsCount = profile.following;
        return {
          status: chalk.magenta("watcher"),
          login: profile.login,
          repos: profile.public_repos,
          followings: followingsCount,
          followers: followerCount,
          impact: calculateImpactFactor(
            followerCount,
            followingsCount,
            profile.public_repos
          ),
          url: profile.html_url,
        };
      })
    )
  ).sort((a, b) => b.impact - a.impact);

  const table = new Table({
    head: Object.keys(watchingResult[0]),
  });
  table.push(
    ...watchingResult.map((user) => Object.values(user)),
    ...watcherResult.map((user) => Object.values(user))
  );
  console.log(table.toString());
}

main(process.argv.slice(2)).catch((err) => {
  console.log(`ERROR: ${err.message}`);
});

function calculateImpactFactor(
  followerCount: number,
  followingsCount: number,
  repoCount: number
): number {
  return (
    Math.log10(repoCount + 0.00001) +
    (followerCount + 0.00001) / (followingsCount + 0.00001)
  );
}

function difference<T>(lhs: Set<T>, rhs: Set<T>) {
  return new Set([...lhs].filter((x) => !rhs.has(x)));
}

function intersect<T>(lhs: Set<T>, rhs: Set<T>) {
  return new Set([...lhs].filter((x) => rhs.has(x)));
}
