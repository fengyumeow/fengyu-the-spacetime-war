# Abstract

Thank you for choosing our Mod Whitelist mod to protect your server from client hacking mods. Let me introduce how it works and what you can do.

This mod works on client and server separately:

- On the client side, it gathers all identifier of mods ("mod_id"s), encrypted them and send to the server.
- On the server side, it checks players who try to connect the server if they install hacking mods, or if they do not install any necessary mods to avoid problems.

But both sides are required. If not:

- Installed on the client side but not installed on the server side. The client player can still enter the server and play, but this mod can not protect your server from hacking.
- Installed on the server side but not installed on the client side. The client player is not allowed to enter the server and sent message "multiplayer.disconnect.mod_whitelist.packet_corruption".

# Adding a mod to whitelist and blacklist

First, you should find the identifier of the mod (modid), a simple way is open the jar file with an archiver software (eg. WinZip, HaoZip, 7-Zip), open "fabric.mod.json" and see what the value of key "id" is. For example, the modid of Mod Whitelist mod is "mod_whitelist".

Then, add it to `CLIENT_MOD_NECESSARY` field if you want client players install it. By default, it is blacklist mode, so you can add it to `CLIENT_MOD_BLACKLIST` field if you do not want client players install it. If you want to use whitelist mode instead, set `USE_WHITELIST_ONLY` to true and add all whitelist modids to `CLIENT_MOD_WHITELIST` field.

In addition, if `USE_WHITELIST_ONLY` is true, `CLIENT_MOD_BLACKLIST` field is just ignored while running the server. And if `USE_WHITELIST_ONLY` is true, `CLIENT_MOD_WHITELIST` field is ignored instead.

As you might see, if fabric-api is installed, the modlist will contains quite a lot of modids. You can run a client with this mod installed, and open ".minecraft/logs/latest.log", and you will see the following format line to simplify gathering the modlist manually:

```

Mod Whitelist vx.x.x from the client! Modlist: ["fabric-api", "fabric-api-base", ...]

```

# Issue tracker

Visit https://github.com/Viola-Siemens/Mod-Whitelist/issues and post your issue and logs if you find any problems with this mod.
