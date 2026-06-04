<h2 align="center">Self Hosted Expo Updates Server</h2>

## Table of Contents

- [Intro](#intro)
- [Install / Setup](#install--setup)
  - [Play around in Dev](#play-around-in-dev)
  - [Deploy on your server](#deploy-on-your-server)
  - [Tech stack](#tech-stack)
  - [Add your app](#add-your-app)
  - [Setup a script to publish updates](#setup-a-script-to-publish-updates)
  - [Generate Self Signed certificate and private key](#generate-self-signed-certificate-and-private-key)
  - [Configure your app](#configure-your-app)
  - [Build a new app](#build-a-new-app)
  - [Publish and release an update](#publish-and-release-an-update)
  - [Monitor the update in realtime](#monitor-the-update-being-downloaded-by-your-client-in-realtime)
- [Advanced Features](#advanced-features)
  - [bsdiff binary patches (Expo SDK 55+)](#bsdiff-binary-patches-expo-sdk-55)
  - [Pre-release integrity checks](#pre-release-integrity-checks)
  - [Disk usage monitoring](#disk-usage-monitoring)
  - [Maintenance & cleanup](#maintenance--cleanup)
- [Example Apps](#example-apps)
  - [ExampleManaged](#examplemanaged)
  - [Production console log in Android](#production-console-log-in-android)
- [Contribute](#contribute)

# Intro

Self Hosted Expo Update Server is a ready to use **_batteries included_** Expo updates compliant server to manage updates that you can host yourself in the cloud and have full control and visibility on the update cycle, including rollbacks!

I love the ability to push over-the-air updates with expo, it is a fantastic feature, but with great power comes great responsibility.
The console-only interface can be tricky, the risk of making mistakes is high (especially on ejected app with incompatible binaries), if you want to roll back you really need to know what you are doing, and a single mistake can have potentially devastating impact.

I have already made a simple helper library that I use in my expo projects to simplify the update setup on the mobile side, check out [expo-custom-updater](https://github.com/umbertoghio/expo-custom-updater)

This is my attempt to simplify my own life when dealing with updates on the server side, and hopefully it can be useful to you too!

Features:

- Manage multiple Expo Apps
- Manage multiple Versions and Release Channels
- Send expo updates securely to the server and decide later when / how to release to users
- Roll back to a previous update
- Get insight on how many client app downloaded the update, see your changes being released in realtime
- Get a ton of info on the update, including git branch, commit, package.json and app.json information
- Assisted app configuration with self-signed certificate generator.
- **bsdiff binary patches** (Expo SDK 55+) — serve tiny incremental update patches instead of full bundles, per-app opt-in
- **Pre-release integrity checks** — the server refuses to release a broken bundle and surfaces a project-wide integrity report
- **Disk usage monitoring** — live storage breakdown (updates / patches / free) right in the dashboard header
- All from a simple Web interface

Monitor client updates in realtime

![ezgif com-gif-maker (1)](https://user-images.githubusercontent.com/25666241/188273081-d55da67d-0906-4348-bc0c-714286e8e812.gif)

A lot of useful information on every update
![image](https://user-images.githubusercontent.com/25666241/187002164-56841c80-27f1-4055-9fa2-f1efd6fe3cf7.png)

Details on dependencies to avoid incompatible updates
![image](https://user-images.githubusercontent.com/25666241/187002193-ee179043-545e-4c71-ba3d-762447688c27.png)

Roll Back to a previous update
![image](https://user-images.githubusercontent.com/25666241/187002214-eaaf68bf-9d17-44b8-afc9-dd27a0f861e0.png)

# Install / Setup

## Play around in Dev

If you have Docker installed you clone this project you and play around by running `bun install` in the root folder and then running `bun run dev:run` to start the Docker/development docker compose. Web credentials are admin/devserver (admin password is set in the docker-compose file).

## Deploy on your server

If you use Docker you can find a production-ready docker-compose files under the Docker folder, just copy Docker/production on your server, set your secrets / credentials and you are ready to go. The two docker images are public and ready to go.
Explanation for the Environment settings is in the docker-compose file. For production reverse proxy with Apache take a look at **README DOCKER.md**

Otherwise you can build from code: the API server lives under the `API` folder and the dashboard under the `Web` folder.

## Tech stack

The project runs on **[Bun](https://bun.sh)** and is written in **TypeScript** end to end:

- **API** — Bun runtime (`bun >= 1.1.0`) running TypeScript directly (no build step), [FeathersJS v5](https://feathersjs.com) services over MongoDB, realtime via Socket.IO. Type-check with `bun run typecheck`.
- **Web** — React 19 + [Vite](https://vitejs.dev) + [PrimeReact](https://primereact.org) + TanStack Query, also served/built through Bun.
- **bsdiff** — a vendored pure-Rust → WebAssembly patch generator (see `API/vendor/bsdiff`), so no `node-gyp` / Python / C++ toolchain is needed to build the image.

Both run in Docker for dev and production; the root-level `bun run lint` / `bun run format` scripts cover the whole repo (API + Web).

## Add your app

Use the web interface to add your application, just enter the expo slug name
![image](https://user-images.githubusercontent.com/25666241/187029334-a1748a96-97e1-4efc-af70-631cea61a152.png)

## Setup a script to publish updates

You can download the ready to use publish script or create your own, the script logic is simple:

- use `expo export` to generate an update
- Add app.json and package.json to the build folder
- Zip the build folder
- use curl to push the zip file to the server

![image](https://user-images.githubusercontent.com/25666241/187029353-9fb6dfe9-913d-4537-900f-673cf7d8e886.png)

## Generate Self Signed certificate and private key

In order to validate the update expo needs a certificate.pem inside your app and a private key on the update server.
Use the SERVER CONFIGURATION section to generate a new self-signed key, make sure to SAVE, then downlaod both key and back them up!
![image](https://user-images.githubusercontent.com/25666241/187003070-c348189d-b159-4cfd-9f03-3801ea7e9b40.png)

## Configure your app

It is necessary to configure your app.json with the provided keys from the APP CONFIGURATION section.
Make sure to have a runtime version specified.

If you are on an Ejected project you can run `expo prebuild` to autogenerate the code in android-manifest.xml and Expo.plist, otherwise use the provided settings in the APP CONFIGURATION with the autogenerated code.

## Build a new app

Updates don't work in dev / expo app, you need to build a new app to test the system. You can use the provided examples (Managed and Ejected) in the relative folders. The provided example app have a button to request and download an update if present, and another button to reload the app.
It is expected that an app will automatically do this operation on start, check out [expo-custom-updater](https://github.com/umbertoghio/expo-custom-updater)

IMPORTANT:
During development you may get certificate issues when loading the JS bundle from your computer, there are two options:

On EXPO >= 49: you can now start the development server specifying your private signing key using the following command:

```
npx expo start --private-key-path (path to the private key)
```

(Thanks @SMhdAsadi )

Alternatively you may allow unsigned manifests by editing Expo.plist and AndroidManifest.xml:

AndroidManifest.xml

```
    <meta-data android:name="expo.modules.updates.CODE_SIGNING_ALLOW_UNSIGNED_MANIFESTS" android:value="true"/>
```

Expo.plist

```
<key>EXUpdatesConfigCodeSigningAllowUnsignedManifests</key>
<true/>
```

Remember to set those back to false before staging / production build!.

Once the app pings the update server you will see an update appearing in the homepage, and after an update / download / reload cycle the updated app will reflect in the dashboar AFTER it asks for an update again.

![ezgif com-gif-maker (1)](https://user-images.githubusercontent.com/25666241/188273081-d55da67d-0906-4348-bc0c-714286e8e812.gif)

## Publish and release an update

This part should be the simplest: call the provided script with appropiate parameters and see your update pop in the web UI.
Release, rollback or delete the updates and see the clients updating in the homepage.

## Monitor the update being downloaded by your client in realtime

Configure the throttle value in docker-compose Environment in order to slow down updates (in case you have thousands of users) to avoid overloads.
Default throttle is no more than one dashboard update every 5 seconds.

![image](https://user-images.githubusercontent.com/25666241/187808147-1c6fac7c-cc95-4fcf-a736-f059b00f83ef.png)

# Advanced Features

## bsdiff binary patches (Expo SDK 55+)

Starting with Expo SDK 55 the native client can apply a **bsdiff binary patch** of the launch JS bundle instead of downloading the whole thing. Incremental updates are typically 5-20× smaller as a patch than as a full bundle, which means faster updates and less bandwidth.

> 📖 Full reference: [bsdiff Binary Patches](docs/bsdiff-binary-patches.md) · internals: [bsdiff Architecture](docs/bsdiff-architecture.md)

> 📷 **Screenshot:** _Bsdiff manager — per-app toggle, total patches size and served count_
> ![Bsdiff manager](https://github.com/user-attachments/assets/4a387199-8634-4cf5-970a-a0e159fe933b)

How it works:

- The client sends `A-IM: bsdiff` together with its current and requested update IDs (only for the launch asset). If a patch is available the server answers `226 IM Used` with the binary patch; otherwise it transparently falls back to a normal `200` full-bundle download. The client also verifies the patched bundle and auto-falls back on any mismatch, so a patch can never break an update.
- Patches are **generated lazily** the first time a client asks for an upgrade path, cached on disk next to the update, and served to every subsequent client. A background worker does the (CPU/RAM-heavy) diffing off the request path.
- Generation is **opt-in per app** via the `bsdiff` toggle in the app screen — roll it out as a canary on one app first.

### Enabling it

1. **Server side:** turn on the `bsdiff` toggle for the app in the Web UI. This controls whether the server generates and serves patches for that app.
2. **Client side:** on SDK 55+ bsdiff patch support is **on by default** — the [`expo-updates`](https://docs.expo.dev/versions/latest/sdk/updates/) config property `updates.enableBsdiffPatchSupport` defaults to `true`, so a standard build already accepts patches. You only need to touch it if it was previously disabled:

   ```json
   {
     "expo": {
       "updates": {
         "enableBsdiffPatchSupport": true
       }
     }
   }
   ```

   This is a **build-time** setting baked into the native project by `expo prebuild` / EAS Build — it cannot be toggled through an OTA update. For bare / ejected projects (or to verify a build) the equivalent native keys are:

   iOS — `Expo.plist`:

   ```xml
   <key>EXUpdatesEnableBsdiffPatchSupport</key>
   <true/>
   ```

   Android — `AndroidManifest.xml` inside `<application>`:

   ```xml
   <meta-data
     android:name="expo.modules.updates.ENABLE_BSDIFF_PATCH_SUPPORT"
     android:value="true" />
   ```

### Managing patches

- **Patches tab / update details** — inspect every patch (status, size, compression ratio, served count) grouped by source → target, and **manually pre-generate** a patch from any compatible base update so the first client doesn't have to wait.
- **Worker settings** — tick interval, failure cooldown, stale-job reclaim window, concurrency and the "benefit ratio" (a patch is only kept if it's meaningfully smaller than the full bundle) are all editable live from the UI. Changing the benefit ratio re-judges already-generated patches.
- **Cleanup** — remove patches whose target update is now obsolete, or purge all patches for an app, with a confirm dialog showing how much disk space will be freed.

> 📷 **Screenshot:** _Patches table grouped by source → target with per-platform status, size, ratio and served count_
> ![Patches table](https://github.com/user-attachments/assets/5272e557-2882-4663-b84e-b3f6a52f99d7)

> 📷 **Screenshot:** _Worker settings tab — live-configurable tick / cooldown / concurrency / benefit ratio_
> ![Worker settings](https://github.com/user-attachments/assets/bce7349e-2793-47b9-b67e-db97ff870ac6)


## Pre-release integrity checks

Before an update is released (or rolled back) the server verifies that the database record and the actual files on disk agree: the zip and extracted directory exist and are readable, `metadata.json` / `app.json` / `package.json` parse, the stored hash still matches the files, and the launch bundle and referenced assets are present (per platform). If anything that would break clients is wrong, the release is **refused** with a clear list of problems — so you can't accidentally ship a corrupt update. A project-wide integrity report is also available to spot drift between the DB and disk.

> 📷 **Screenshot:** _Project integrity report listing uploads with their issues (errors / warnings)_

<!-- ![Integrity report](docs/images/integrity-report.png) -->

## Disk usage monitoring

The dashboard header shows a live storage breakdown: bytes used by updates, by patches, and total / free space on the updates volume (read via `fs.statfs`). The full FS walk is cached in-process; **click the chip** to set the cache window (default 30s). On Linux production the defaults work out of the box. Two optional env vars tune the paths:

- `UPDATES_ROOT` — directory walked for the updates/patches totals (default `/updates`).
- `DISK_STAT_PATH` — path used for the free/total figures (default = `UPDATES_ROOT`). On macOS Docker Desktop dev, bind mounts report nonsense through virtio-fs, so the dev compose sets `DISK_STAT_PATH=/` to read the VM overlay root instead.

> 📷 **Screenshot:** _Dashboard header chip — Updates / Patches / Used / Free_
> ![Disk usage chip](https://github.com/user-attachments/assets/467fa60c-9af1-4327-a6f8-4e8bc9161a7a)

## Maintenance & cleanup

Storage and database hygiene tools, all driven from the Web UI:

- **Soft-delete** — deleting an update marks it as `deleted` (a tombstone) rather than wiping the record: the on-disk bundle files are removed, but the metadata is kept so client-reported update IDs can still be resolved and the row can be re-surfaced via the status filter.
- **Clean up old updates** — bulk-remove updates older than a chosen window, with safety gates: a currently-released update is never touched, and neither is one that any client still reports as its current update (nobody gets stranded). A preview shows exactly what will be removed before you confirm.
- **Purge deleted** — permanently drop tombstoned records once you're sure they're no longer needed.
- **Orphan scan** — find files on disk that no database record references (leftover zips / extracted directories from interrupted uploads or manual tinkering) and delete them to reclaim space.
- **Date-range filtering** — the update and patch tables support filtering by date range to make all of the above easier to target.

> 📷 **Screenshot:** _"Clean up old updates" preview dialog showing candidates and reclaimable space_
> ![Cleanup old updates](https://github.com/user-attachments/assets/ff77ecaf-2d09-4375-9fde-2ce99305ce37)

> 📷 **Screenshot:** _Orphan scan results — on-disk files with no DB record_

<!-- ![Orphan scan](docs/images/orphan-scan.png) -->

# Example Apps

## ExampleManaged

You will find an example app in the Example Managed folder, to start tweaking it up you need:

- Copy App public certificate from server to **/code-signing/certificate.pem**
- Teweak app.json and app.config.js, specially the updates section to point to the right server
- Create an Android or iOS build using the respective scripts in package.json
- Install and test the app
- Make some changes in the app code in App.js
- Publish an update with `scripts/expo-publish-selfhosted.sh staging ./ExampleManaged abc123def456 http://localhost:3000`
- Test the update within the app

## Production console log in Android

You can see tailored console output using ADB logcat like this:

- View only RN and Expo updates output `adb logcat "*:S" ReactNative:V ReactNativeJS:V FirebaseMessaging:V dev.expo.updates:V`
- Clear logs `adb logcat -c`

# Contribute

Feel free to clone, costomize and send back PRs!

Have fun!
