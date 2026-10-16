/* Referee Games.
   Reads and writes referee-games.json in the private progress-sync repo.
   This file ships no match contents. */
(function () {
  "use strict";

  var APP_ID = "referee-games";
  var TZ = "Europe/Lisbon";
  var PAST_STATUS = { done: 1, past: 1, played: 1, finished: 1 };
  var UPCOMING_STATUS = { upcoming: 1, scheduled: 1, next: 1 };

  var els = {
    sync: document.getElementById("sync-label"),
    main: document.getElementById("main"),
    connect: document.getElementById("connect"),
    connectBtn: document.getElementById("btn-connect")
  };

  var doc = null;
  var dirty = false;
  var inSave = false;
  var saving = false;
  var saveAgain = false;
  var saveTimer = null;
  var retried = false;
  var loading = false;
  var loadNote = "";
  var mode = { type: "list" };
  var pastOpen = false;
  var jumpTop = false;
  var openGames = {};
  var openSubs = {};
  var crestByNorm = {};
  var extras = null;
  var venueByNorm = {};
  var clubByNorm = {};
  var CHECK_ITEMS = [
    ["cards", "Cards"],
    ["whistle", "Whistle"],
    ["watch", "Watch"],
    ["licence", "Licence"],
    ["sheet", "Match sheet"]
  ];
  var REF_SHIRTS = ["black", "yellow", "red", "green", "blue"];
  var COLOUR_FAMILY = {
    black: "black", preto: "black", preta: "black", negro: "black", negra: "black",
    yellow: "yellow", amarelo: "yellow", amarela: "yellow", gold: "yellow", dourado: "yellow", dourada: "yellow",
    red: "red", vermelho: "red", vermelha: "red", encarnado: "red", encarnada: "red",
    grena: "red", grenat: "red", bordo: "red", burgundy: "red", maroon: "red", claret: "red",
    green: "green", verde: "green",
    blue: "blue", azul: "blue", celeste: "blue",
    white: "white", branco: "white", branca: "white",
    orange: "orange", laranja: "orange",
    purple: "purple", roxo: "purple", roxa: "purple", violeta: "purple",
    pink: "pink", rosa: "pink",
    grey: "grey", gray: "grey", cinza: "grey", cinzento: "grey", cinzenta: "grey"
  };
  var CREST_DROP = {
    de: 1, da: 1, do: 1, dos: 1, das: 1, e: 1, a: 1, o: 1, os: 1, as: 1,
    futebol: 1, clube: 1, club: 1, sport: 1, sporting: 1, grupo: 1,
    desportivo: 1, desportiva: 1, associacao: 1, recreativo: 1, recreativa: 1,
    cultural: 1, uniao: 1, atletico: 1, centro: 1, atl: 1, sp: 1,
    fc: 1, sc: 1, gd: 1, ad: 1, ud: 1, cf: 1, cd: 1, ac: 1, cr: 1, sad: 1, gfc: 1, afc: 1
  };

  function line(value) {
    if (value == null) return "";
    return String(value).replace(/\s+/g, " ").trim();
  }

  function blockText(value) {
    if (value == null) return "";
    return String(value).replace(/\r\n/g, "\n").trim();
  }

  function hasLine(value) {
    return line(value) !== "";
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function hhmm() {
    var now = new Date();
    return pad2(now.getHours()) + ":" + pad2(now.getMinutes());
  }

  function hasToken() {
    try {
      var cfg = JSON.parse(localStorage.getItem("dong-gh-sync") || "null");
      return !!(cfg && cfg.token);
    } catch (e) {
      return false;
    }
  }

  function showConnect() {
    if (els.connect) els.connect.hidden = hasToken();
  }

  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null && text !== "") el.textContent = text;
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function tzOffset(utcMs) {
    var fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    var map = {};
    fmt.formatToParts(new Date(utcMs)).forEach(function (part) {
      if (part.type !== "literal") map[part.type] = part.value;
    });
    var hour = +map.hour;
    var day = +map.day;
    if (hour === 24) {
      hour = 0;
      day += 1;
    }
    var asUTC = Date.UTC(+map.year, +map.month - 1, day, hour, +map.minute, +map.second);
    return asUTC - utcMs;
  }

  function zonedMs(date, time) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
    var t = /^(\d{1,2}):(\d{2})$/.exec(time || "");
    if (!m || !t) return null;
    var hh = +t[1];
    var mm = +t[2];
    if (hh > 23 || mm > 59) return null;
    var utcGuess = Date.UTC(+m[1], +m[2] - 1, +m[3], hh, mm, 0);
    var off = tzOffset(utcGuess);
    var instant = utcGuess - off;
    var off2 = tzOffset(instant);
    if (off2 !== off) instant = utcGuess - off2;
    return instant;
  }

  function lisbonToday() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  function formatDateLabel(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
    var ms = zonedMs(iso, "12:00");
    if (ms == null) return iso;
    var nowYear = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric"
    }).format(new Date());
    var opts = { timeZone: TZ, weekday: "short", day: "numeric", month: "short" };
    if (iso.slice(0, 4) !== nowYear) opts.year = "numeric";
    return new Intl.DateTimeFormat("en-GB", opts).format(new Date(ms));
  }

  function whenLabel(game) {
    var date = formatDateLabel(line(game.date));
    var time = line(game.time);
    if (date && time) return date + " · " + time;
    return date || time;
  }

  function countdownLabel(ms) {
    if (!isFinite(ms)) return "";
    var diff = ms - Date.now();
    if (diff > 0) {
      var mins = Math.floor(diff / 60000);
      var days = Math.floor(mins / 1440);
      var hours = Math.floor((mins - days * 1440) / 60);
      var minutes = mins % 60;
      if (days > 0) return "Kickoff in " + days + "d " + hours + "h";
      if (hours > 0) return "Kickoff in " + hours + "h " + minutes + "m";
      if (minutes > 0) return "Kickoff in " + minutes + "m";
      return "Kickoff in <1m";
    }
    if (diff > -2 * 60 * 60 * 1000) return "In progress";
    return "Full time";
  }

  function countdownClass(ms) {
    var diff = ms - Date.now();
    if (diff > 0) return "countdown";
    if (diff > -2 * 60 * 60 * 1000) return "countdown live";
    return "countdown over";
  }

  function sortKey(game) {
    var date = line(game && game.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    var time = line(game.time);
    if (!/^\d{1,2}:\d{2}$/.test(time)) time = "00:00";
    var bits = time.split(":");
    return date + "T" + pad2(+bits[0]) + ":" + bits[1];
  }

  function isPast(game) {
    var status = line(game && game.status).toLowerCase();
    if (PAST_STATUS[status]) return true;
    if (UPCOMING_STATUS[status]) return false;
    var date = line(game && game.date);
    if (!date) return false;
    if (!line(game.time)) return date < lisbonToday();
    var ms = zonedMs(date, line(game.time));
    if (ms == null) return false;
    return ms < Date.now();
  }

  function byDate(dir) {
    return function (a, b) {
      var ka = sortKey(a);
      var kb = sortKey(b);
      if (ka == null && kb == null) return 0;
      if (ka == null) return 1;
      if (kb == null) return -1;
      if (ka === kb) return 0;
      var cmp = ka < kb ? -1 : 1;
      return dir === "desc" ? -cmp : cmp;
    };
  }

  function normalize(data) {
    var d = isRecord(data) ? data : {};
    if (!Array.isArray(d.games)) d.games = [];
    d.games = d.games.filter(function (game) {
      return isRecord(game);
    });
    var seen = {};
    d.games.forEach(function (game, index) {
      var id = line(game.id);
      if (!id || seen[id]) {
        var n = index + 1;
        id = "game-" + n;
        while (seen[id]) {
          n += 1;
          id = "game-" + n;
        }
      }
      game.id = id;
      seen[id] = true;
    });
    if (d.version == null) d.version = 1;
    return d;
  }

  function personName(value) {
    if (typeof value === "string") return line(value);
    if (isRecord(value)) return line(value.name);
    return "";
  }

  function personPhone(value) {
    if (!isRecord(value)) return "";
    return line(value.phone);
  }

  function telHref(phone) {
    var cleaned = String(phone || "").replace(/[^\d+]/g, "");
    if (!/\d/.test(cleaned)) return "";
    return "tel:" + cleaned;
  }

  function tableBits(side) {
    if (!isRecord(side)) return "";
    var bits = [];
    if (side.pos != null && side.pos !== "" && isFinite(Number(side.pos))) {
      bits.push("Pos " + Number(side.pos));
    }
    if (side.pts != null && side.pts !== "" && isFinite(Number(side.pts))) {
      var pts = Number(side.pts);
      var shown = Number.isInteger(pts) ? String(pts) : String(pts);
      bits.push(shown + (pts === 1 ? " pt" : " pts"));
    }
    return bits.join(" · ");
  }

  function sideText(group, key) {
    if (!isRecord(group)) return "";
    var value = group[key];
    if (value == null || typeof value === "object") return "";
    return line(value);
  }

  function timingsOf(prep) {
    if (!isRecord(prep) || !Array.isArray(prep.timings)) return [];
    return prep.timings.filter(function (item) {
      return isRecord(item) && (hasLine(item.time) || hasLine(item.label));
    });
  }

  function rulesOf(prep) {
    if (!isRecord(prep) || !Array.isArray(prep.rules)) return [];
    return prep.rules.map(line).filter(Boolean);
  }

  function slugPart(value) {
    return line(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
  }

  function uniqueId(date, home, away, currentId) {
    var base = [line(date) || "game", slugPart(home) || "home", slugPart(away) || "away"].join("-");
    var taken = {};
    (doc.games || []).forEach(function (game) {
      if (game && game.id && game.id !== currentId) taken[game.id] = true;
    });
    var id = base;
    var n = 2;
    while (taken[id]) {
      id = base + "-" + n;
      n += 1;
    }
    return id;
  }

  function findGame(id) {
    var found = null;
    (doc && doc.games || []).some(function (game) {
      if (game && game.id === id) {
        found = game;
        return true;
      }
      return false;
    });
    return found;
  }

  function renderEmpty(message) {
    clear(els.main);
    var card = node("section", "card empty");
    card.appendChild(node("span", "big", "🏁"));
    card.appendChild(node("p", "", message));
    els.main.appendChild(card);
  }

  function addButton() {
    var btn = node("button", "add-btn", "Add game");
    btn.type = "button";
    btn.setAttribute("data-action", "add");
    return btn;
  }

  function appendWhen(parent, game) {
    var label = whenLabel(game);
    var ms = hasLine(game.date) && hasLine(game.time) ? zonedMs(line(game.date), line(game.time)) : null;
    if (!label && ms == null) return;
    var row = node("p", "when-line");
    if (label) {
      var time = node("time", "", label);
      if (hasLine(game.date)) {
        time.setAttribute("datetime", line(game.date) + (hasLine(game.time) ? "T" + line(game.time) : ""));
      }
      row.appendChild(time);
    }
    if (ms != null) {
      var count = node("span", countdownClass(ms), countdownLabel(ms));
      count.setAttribute("data-countdown", String(ms));
      row.appendChild(count);
    }
    parent.appendChild(row);
  }

  function appendFacts(parent, game) {
    var venue = line(game.venue);
    var aol = line(game.aolCode);
    if (!venue && !aol) return;
    var facts = node("div", "facts");
    if (venue) {
      var place = node("div", "fact");
      place.appendChild(node("span", "fact-label", "Venue"));
      var map = node("a", "map", venue);
      map.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(venue);
      map.target = "_blank";
      map.rel = "noopener noreferrer";
      place.appendChild(map);
      facts.appendChild(place);
    }
    if (aol) {
      var code = node("div", "fact");
      code.appendChild(node("span", "fact-label", "AOL"));
      code.appendChild(node("p", "aol", aol));
      facts.appendChild(code);
    }
    parent.appendChild(facts);
  }

  function personRow(role, value) {
    var name = personName(value);
    var phone = personPhone(value);
    if (!name && !phone) return null;
    var row = node("div", "person");
    var meta = node("div", "person-meta");
    meta.appendChild(node("span", "person-role", role));
    if (name) meta.appendChild(node("span", "person-name", name));
    row.appendChild(meta);
    if (phone) {
      var href = telHref(phone);
      if (href) {
        var link = node("a", "phone", phone);
        link.href = href;
        link.setAttribute("aria-label", "Call " + (name || role));
        row.appendChild(link);
      } else {
        row.appendChild(node("span", "split-value", phone));
      }
    }
    return row;
  }

  function appendTeam(parent, game) {
    var team = isRecord(game.team) ? game.team : null;
    var role = line(game.role);
    var rows = [];
    if (team) {
      [personRow("Referee", team.referee), personRow("AA1", team.aa1), personRow("AA2", team.aa2)]
        .forEach(function (row) {
          if (row) rows.push(row);
        });
    }
    if (!rows.length && !role) return;
    var block = node("section", "block");
    block.appendChild(node("h3", "", "Referee team"));
    rows.forEach(function (row) { block.appendChild(row); });
    if (role) {
      var row = node("div", "split");
      row.appendChild(node("span", "split-name", "Role"));
      row.appendChild(node("span", "split-value", role));
      block.appendChild(row);
    }
    parent.appendChild(block);
  }

  function splitRow(name, value) {
    if (!hasLine(value)) return null;
    var row = node("div", "split");
    row.appendChild(node("span", "split-name", hasLine(name) ? line(name) : "Team"));
    row.appendChild(node("span", "split-value", line(value)));
    return row;
  }

  function appendSplits(parent, title, homeName, awayName, homeValue, awayValue) {
    var home = splitRow(homeName, homeValue);
    var away = splitRow(awayName, awayValue);
    if (!home && !away) return;
    var block = node("section", "block");
    block.appendChild(node("h3", "", title));
    if (home) block.appendChild(home);
    if (away) block.appendChild(away);
    parent.appendChild(block);
  }

  function appendPrep(parent, game) {
    var prep = isRecord(game.prep) ? game.prep : null;
    var timings = timingsOf(prep);
    if (!timings.length) return;
    var block = node("section", "block");
    block.appendChild(node("h3", "", "Prep"));
    var list = node("ol", "prep");
    timings.forEach(function (item) {
      var li = document.createElement("li");
      if (hasLine(item.time)) li.appendChild(node("time", "", line(item.time)));
      if (hasLine(item.label)) li.appendChild(node("span", "", line(item.label)));
      list.appendChild(li);
    });
    block.appendChild(list);
    parent.appendChild(block);
  }

  function appendRules(parent, game) {
    var rules = rulesOf(isRecord(game.prep) ? game.prep : null);
    if (!rules.length) return;
    var block = node("section", "block");
    block.appendChild(node("h3", "", "Rules"));
    var list = node("ul", "rules");
    rules.forEach(function (rule) {
      list.appendChild(node("li", "", rule));
    });
    block.appendChild(list);
    parent.appendChild(block);
  }

  function appendNotes(parent, game) {
    if (typeof game.notes !== "string" || !blockText(game.notes)) return;
    var block = node("section", "block");
    block.appendChild(node("h3", "", "Notes"));
    block.appendChild(node("p", "notes", blockText(game.notes)));
    parent.appendChild(block);
  }

  function foldName(value) {
    return line(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function normClub(value) {
    return foldName(value)
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(function (word) {
        return word && !CREST_DROP[word];
      })
      .join(" ");
  }

  function crestFile(name) {
    var key = normClub(name);
    var file = key ? crestByNorm[key] : "";
    if (!file || !/^[a-z0-9][a-z0-9.-]{0,80}\.(webp|png)$/.test(file)) return "";
    return file;
  }

  function initialsOf(name) {
    var parts = line(name).split(/\s+/).filter(Boolean);
    var words = parts.filter(function (word) {
      var token = foldName(word).replace(/[^a-z0-9]/g, "");
      return token && !CREST_DROP[token];
    });
    if (!words.length) words = parts;
    if (!words.length) return "";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }

  function badgeColor(name) {
    var text = normClub(name) || foldName(name) || "club";
    var hash = 0;
    for (var i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
    return "hsl(" + (hash % 360) + " 48% 26%)";
  }

  function initialsBadge(name) {
    var badge = node("span", "crest-fallback", initialsOf(name) || "?");
    badge.style.background = badgeColor(name);
    badge.setAttribute("aria-hidden", "true");
    return badge;
  }

  function crestEl(name) {
    var file = crestFile(name);
    if (!file) return initialsBadge(name);
    var img = document.createElement("img");
    img.className = "crest";
    img.alt = "";
    img.width = 24;
    img.height = 24;
    img.decoding = "async";
    img.src = "assets/crests/" + file;
    img.addEventListener("error", function () {
      var badge = initialsBadge(name);
      if (img.parentNode) img.parentNode.replaceChild(badge, img);
    });
    return img;
  }

  function rowDateLabel(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
    var ms = zonedMs(iso, "12:00");
    if (ms == null) return iso;
    var nowYear = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric"
    }).format(new Date());
    var opts = { timeZone: TZ, day: "numeric", month: "short" };
    if (iso.slice(0, 4) !== nowYear) opts.year = "2-digit";
    return new Intl.DateTimeFormat("en-GB", opts).format(new Date(ms));
  }

  function rowCountText(game) {
    if (isPast(game)) return "played";
    var date = line(game && game.date);
    var time = line(game && game.time);
    if (date && date === lisbonToday()) return time ? "today " + time : "today";
    var ms = date && time ? zonedMs(date, time) : null;
    if (ms == null) return "";
    var diff = ms - Date.now();
    if (diff <= 0) return "played";
    var mins = Math.floor(diff / 60000);
    var days = Math.floor(mins / 1440);
    var hours = Math.floor((mins - days * 1440) / 60);
    var minutes = mins % 60;
    if (days > 0) return "in " + days + "d " + hours + "h";
    if (hours > 0) return "in " + hours + "h " + minutes + "m";
    if (minutes > 0) return "in " + minutes + "m";
    return "in <1m";
  }

  function renderSummary(game) {
    var summary = document.createElement("summary");
    summary.className = "match-row";
    var home = line(game.home);
    var away = line(game.away);
    var date = rowDateLabel(line(game.date));
    var time = line(game.time);
    if (date) summary.appendChild(node("span", "row-date", date));
    if (time) summary.appendChild(node("span", "row-time", time));
    var teams = node("span", "row-teams");
    if (home || away) {
      teams.appendChild(crestEl(home));
      teams.appendChild(node("span", "row-club home", home || "Home"));
      teams.appendChild(node("span", "row-vs", "vs"));
      teams.appendChild(crestEl(away));
      teams.appendChild(node("span", "row-club away", away || "Away"));
    } else {
      teams.appendChild(node("span", "row-club", "Untitled game"));
    }
    summary.appendChild(teams);
    var count = node("span", "row-count", rowCountText(game));
    count.setAttribute("data-row-count", "1");
    count.setAttribute("data-date", line(game.date));
    count.setAttribute("data-time", line(game.time));
    count.setAttribute("data-status", line(game.status));
    summary.appendChild(count);
    return summary;
  }

  function safeHttp(url) {
    var value = line(url);
    if (!/^https:\/\/\S+$/i.test(value)) return "";
    return value;
  }

  function extrasGame(game) {
    if (!extras || !Array.isArray(extras.games)) return null;
    var id = line(game && game.id);
    if (!id) return null;
    for (var i = 0; i < extras.games.length; i += 1) {
      var item = extras.games[i];
      if (isRecord(item) && line(item.id) === id) return item;
    }
    return null;
  }

  function indexExtras(data) {
    extras = isRecord(data) ? data : null;
    venueByNorm = {};
    clubByNorm = {};
    if (!extras) return;
    var venues = isRecord(extras.venues) ? extras.venues : {};
    Object.keys(venues).forEach(function (name) {
      var venue = venues[name];
      if (!isRecord(venue)) return;
      [name, venue.osm_name, venue.address].forEach(function (label) {
        var key = normClub(label);
        if (key && !venueByNorm[key]) venueByNorm[key] = venue;
      });
    });
    var clubs = isRecord(extras.clubs) ? extras.clubs : {};
    Object.keys(clubs).forEach(function (name) {
      var club = clubs[name];
      if (!isRecord(club)) return;
      [name, club.full_name].forEach(function (label) {
        var key = normClub(label);
        if (key && !clubByNorm[key]) clubByNorm[key] = club;
      });
    });
  }

  function venueRecord(game) {
    var named = line(game.venue);
    if (named) {
      var hit = venueByNorm[normClub(named)];
      if (hit) return hit;
    }
    var extra = extrasGame(game);
    var extraVenue = extra ? line(extra.venue) : "";
    if (!extraVenue) return null;
    if (named && normClub(named) !== normClub(extraVenue)) return null;
    return venueByNorm[normClub(extraVenue)] || null;
  }

  function drivingMinutes(record) {
    if (!record) return null;
    var minutes = record.driving_minutes_from_guimaraes;
    if (typeof minutes !== "number" || !isFinite(minutes) || minutes < 0) return null;
    if (!safeHttp(record.route_source_url)) return null;
    return Math.round(minutes);
  }

  function lisbonClock(ms) {
    var date = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(ms));
    var parts = {};
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(new Date(ms)).forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    var hour = parts.hour === "24" ? "00" : parts.hour;
    return { date: date, time: hour + ":" + parts.minute };
  }

  function leaveByText(game, minutes) {
    var ms = zonedMs(line(game.date), line(game.time));
    if (ms == null) return "";
    var clock = lisbonClock(ms - (minutes + 60) * 60000);
    if (clock.date !== line(game.date)) {
      var label = formatDateLabel(clock.date);
      return label ? label + " · " + clock.time : clock.time;
    }
    return clock.time;
  }

  function originLabel() {
    var origin = extras && isRecord(extras.driving_origin) ? line(extras.driving_origin.label) : "";
    return origin || "Guimarães";
  }

  function subDetails(key, title, gameId) {
    var el = document.createElement("details");
    el.className = "subdetails";
    var storeKey = line(gameId) + ":" + key;
    el.setAttribute("data-sub", storeKey);
    if (openSubs[storeKey]) el.open = true;
    var summary = document.createElement("summary");
    summary.textContent = title;
    el.appendChild(summary);
    var body = node("div", "sub-body");
    el.appendChild(body);
    return { el: el, body: body };
  }

  function externalLink(href, text, className) {
    var url = safeHttp(href);
    if (!url) return null;
    var link = node("a", className || "", text || url);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function appendVenueSection(parent, game) {
    var block = subDetails("venue", "Venue", game.id);
    var record = venueRecord(game);
    var named = line(game.venue);
    var address = record ? line(record.address) : "";
    var label = address || named;
    var maps = record ? safeHttp(record.maps_url) : "";
    if (!maps && label) {
      maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(label);
    }
    if (!label && !maps) {
      block.body.appendChild(node("p", "gap-note", "—"));
    } else {
      var link = externalLink(maps, label || "Map", "map");
      if (link) block.body.appendChild(link);
      else if (label) block.body.appendChild(node("p", "detail-line", label));
      var minutes = drivingMinutes(record);
      if (minutes != null) {
        block.body.appendChild(node("p", "detail-line", minutes + " min drive from " + originLabel()));
        var leave = leaveByText(game, minutes);
        if (leave) block.body.appendChild(node("p", "detail-line", "Leave by " + leave));
      }
    }
    parent.appendChild(block.el);
  }

  function clubRecord(name) {
    var key = normClub(name);
    return key && clubByNorm[key] ? clubByNorm[key] : null;
  }

  function knownColours(club) {
    if (!club || !line(club.primary)) return null;
    return {
      primary: line(club.primary),
      secondary: line(club.secondary),
      source: safeHttp(club.source_url)
    };
  }

  function colourFamilies(text) {
    var words = foldName(text).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
    var found = [];
    words.forEach(function (word) {
      var family = COLOUR_FAMILY[word];
      if (family && found.indexOf(family) < 0) found.push(family);
    });
    return found.length ? found : null;
  }

  function shirtWord(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function refereeShirt(homeFamilies, awayFamilies) {
    if (!homeFamilies || !awayFamilies) return "";
    var blocked = {};
    homeFamilies.concat(awayFamilies).forEach(function (family) {
      if (REF_SHIRTS.indexOf(family) >= 0) blocked[family] = 1;
    });
    for (var i = 0; i < REF_SHIRTS.length; i += 1) {
      if (!blocked[REF_SHIRTS[i]]) return shirtWord(REF_SHIRTS[i]);
    }
    return "";
  }

  function appendColourLine(parent, name, colours) {
    var row = node("p", "detail-line");
    var shown = "—";
    if (colours) {
      shown = colours.primary;
      if (colours.secondary) shown += " / " + colours.secondary;
    }
    row.appendChild(document.createTextNode((name || "Team") + ": " + shown));
    if (colours && colours.source) {
      row.appendChild(document.createTextNode(" "));
      var link = externalLink(colours.source, "source");
      if (link) row.appendChild(link);
    }
    parent.appendChild(row);
  }

  function appendKitSection(parent, game) {
    var block = subDetails("kits", "Kits", game.id);
    var home = knownColours(clubRecord(game.home));
    var away = knownColours(clubRecord(game.away));
    appendColourLine(block.body, line(game.home) || "Home", home);
    appendColourLine(block.body, line(game.away) || "Away", away);
    var homeText = home ? [home.primary, home.secondary].filter(Boolean).join(" ") : "";
    var awayText = away ? [away.primary, away.secondary].filter(Boolean).join(" ") : "";
    var suggestion = refereeShirt(
      home ? colourFamilies(homeText) : null,
      away ? colourFamilies(awayText) : null
    );
    block.body.appendChild(node("p", "detail-line", "Referee shirt: " + (suggestion || "—")));
    parent.appendChild(block.el);
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  }

  function readChecks(id) {
    try {
      var data = JSON.parse(storageGet("referee-games:check:" + id) || "null");
      return isRecord(data) ? data : {};
    } catch (e) {
      return {};
    }
  }

  function appendChecklist(parent, game) {
    var block = subDetails("checklist", "Pre-game checklist", game.id);
    var saved = readChecks(game.id);
    var list = node("div", "checks");
    CHECK_ITEMS.forEach(function (item) {
      var label = node("label", "check");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!saved[item[0]];
      input.addEventListener("change", function () {
        var current = readChecks(game.id);
        current[item[0]] = input.checked;
        storageSet("referee-games:check:" + game.id, JSON.stringify(current));
      });
      label.appendChild(input);
      label.appendChild(node("span", "", item[1]));
      list.appendChild(label);
    });
    block.body.appendChild(list);
    parent.appendChild(block.el);
  }

  function linesFrom(value) {
    if (value == null) return [];
    if (typeof value === "string") {
      var text = blockText(value);
      return text ? text.split("\n").map(line).filter(Boolean) : [];
    }
    if (Array.isArray(value)) {
      var out = [];
      value.forEach(function (item) {
        linesFrom(item).forEach(function (part) { out.push(part); });
      });
      return out;
    }
    if (!isRecord(value)) return [];
    var name = line(value.name || value.player);
    var reason = line(value.reason || value.detail);
    if (name || reason) return [name && reason ? name + " — " + reason : (name || reason)];
    var bits = [];
    ["summary", "note", "notes", "result", "score", "home", "away"].forEach(function (key) {
      if (typeof value[key] === "string" && line(value[key])) bits.push(line(value[key]));
    });
    return bits;
  }

  function factLines(game, keys) {
    var lines = [];
    var sources = [game, extrasGame(game)];
    sources.forEach(function (source) {
      if (!isRecord(source)) return;
      keys.forEach(function (key) {
        linesFrom(source[key]).forEach(function (part) {
          if (lines.indexOf(part) < 0) lines.push(part);
        });
      });
    });
    return lines;
  }

  function appendFactSection(parent, key, title, game, keys, empty) {
    var block = subDetails(key, title, game.id);
    var lines = factLines(game, keys);
    if (!lines.length) {
      block.body.appendChild(node("p", "gap-note", empty));
    } else {
      lines.forEach(function (text) {
        block.body.appendChild(node("p", "detail-line", text));
      });
    }
    parent.appendChild(block.el);
  }

  function appendAssessment(parent, game) {
    var block = subDetails("assessment", "Post-game self-assessment", game.id);
    var area = document.createElement("textarea");
    area.className = "self-note";
    area.rows = 4;
    area.setAttribute("aria-label", "Post-game self-assessment");
    area.value = storageGet("referee-games:note:" + game.id) || "";
    area.addEventListener("input", function () {
      storageSet("referee-games:note:" + game.id, area.value);
    });
    block.body.appendChild(area);
    block.body.appendChild(node("p", "device-note", "Saved on this device only."));
    parent.appendChild(block.el);
  }

  function contactBits(value) {
    if (typeof value === "string") {
      var name = line(value);
      return name ? { name: name, phone: "", email: "" } : null;
    }
    if (!isRecord(value)) return null;
    var bits = {
      name: line(value.name),
      phone: line(value.phone),
      email: line(value.email)
    };
    if (!bits.name && !bits.phone && !bits.email) return null;
    return bits;
  }

  function appendContactPerson(parent, labelText, bits) {
    var wrap = node("div", "contact");
    wrap.appendChild(node("span", "fact-label", labelText));
    if (!bits) {
      wrap.appendChild(node("p", "gap-note", "Not set"));
      parent.appendChild(wrap);
      return;
    }
    if (bits.name) wrap.appendChild(node("p", "detail-line", bits.name));
    if (bits.phone) {
      var href = telHref(bits.phone);
      if (href) {
        var phone = node("a", "phone", bits.phone);
        phone.href = href;
        wrap.appendChild(phone);
      } else {
        wrap.appendChild(node("p", "detail-line", bits.phone));
      }
    }
    if (bits.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bits.email)) {
      var mail = node("a", "phone", bits.email);
      mail.href = "mailto:" + bits.email;
      wrap.appendChild(mail);
    } else if (bits.email) {
      wrap.appendChild(node("p", "detail-line", bits.email));
    }
    parent.appendChild(wrap);
  }

  function appendContacts(parent, game) {
    var block = subDetails("contacts", "Contacts", game.id);
    var team = isRecord(game.team) ? game.team : null;
    var delegate = contactBits(game.delegate) || contactBits(team && team.delegate);
    appendContactPerson(block.body, "Delegate", delegate);
    var office = extras && isRecord(extras.af_braga) ? extras.af_braga : null;
    var wrap = node("div", "contact");
    wrap.appendChild(node("span", "fact-label", "AF Braga"));
    var address = office ? line(office.address) : "";
    var phones = office && Array.isArray(office.phones) ? office.phones.map(line).filter(Boolean) : [];
    var email = office ? line(office.email) : "";
    var source = office ? safeHttp(office.source_url) : "";
    if (!address && !phones.length && !email) {
      wrap.appendChild(node("p", "gap-note", "Not set"));
    } else {
      if (address) wrap.appendChild(node("p", "detail-line", address));
      phones.forEach(function (phone) {
        var href = telHref(phone);
        if (!href) {
          wrap.appendChild(node("p", "detail-line", phone));
          return;
        }
        var link = node("a", "phone", phone);
        link.href = href;
        wrap.appendChild(link);
      });
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        var mail = node("a", "phone", email);
        mail.href = "mailto:" + email;
        wrap.appendChild(mail);
      }
      if (source) {
        var cite = externalLink(source, source, "source");
        if (cite) wrap.appendChild(cite);
      }
    }
    block.body.appendChild(wrap);
    parent.appendChild(block.el);
  }

  function appendDetailSections(parent, game) {
    appendVenueSection(parent, game);
    appendKitSection(parent, game);
    appendChecklist(parent, game);
    appendFactSection(parent, "discipline", "Discipline", game, ["discipline", "dangerPlayers", "danger_players"], "No data");
    appendFactSection(parent, "h2h", "Head-to-head", game, ["headToHead", "head_to_head", "lastMeeting", "last_meeting"], "No data");
    appendAssessment(parent, game);
    appendContacts(parent, game);
  }

  function renderCard(game, past) {
    var card = node("article", past ? "match is-past" : "match");
    card.setAttribute("data-game-id", game.id);
    var fold = document.createElement("details");
    fold.className = "match-fold";
    if (openGames[game.id]) fold.open = true;
    fold.appendChild(renderSummary(game));
    var body = node("div", "match-body");
    body.appendChild(node("div", "match-stripe"));

    var comp = line(game.competition);
    var jornada = game.jornada;
    var hasJornada = jornada != null && jornada !== "" && (typeof jornada === "number" || typeof jornada === "string");
    if (comp || hasJornada) {
      var top = node("div", "match-top");
      if (comp) top.appendChild(node("p", "comp", comp));
      if (hasJornada) top.appendChild(node("span", "jornada", "Jornada " + line(jornada)));
      body.appendChild(top);
    }

    var home = line(game.home);
    var away = line(game.away);
    if (home && away) {
      var teams = node("div", "teams");
      var homeSide = node("div", "side home");
      var homeHead = node("div", "side-head");
      homeHead.appendChild(crestEl(home));
      var homeText = node("div", "side-text");
      homeText.appendChild(node("span", "side-label", "Home"));
      homeText.appendChild(node("h2", "", home));
      homeHead.appendChild(homeText);
      homeSide.appendChild(homeHead);
      var awaySide = node("div", "side away");
      var awayHead = node("div", "side-head");
      awayHead.appendChild(crestEl(away));
      var awayText = node("div", "side-text");
      awayText.appendChild(node("span", "side-label", "Away"));
      awayText.appendChild(node("h2", "", away));
      awayHead.appendChild(awayText);
      awaySide.appendChild(awayHead);
      teams.appendChild(homeSide);
      teams.appendChild(node("div", "vs", "VS"));
      teams.appendChild(awaySide);
      body.appendChild(teams);
    } else if (home || away) {
      var one = node("div", "teams single");
      var side = node("div", "side");
      var head = node("div", "side-head");
      head.appendChild(crestEl(home || away));
      var text = node("div", "side-text");
      text.appendChild(node("span", "side-label", home ? "Home" : "Away"));
      text.appendChild(node("h2", "", home || away));
      head.appendChild(text);
      side.appendChild(head);
      one.appendChild(side);
      body.appendChild(one);
    } else {
      body.appendChild(node("h2", "untitled", "Untitled game"));
    }

    appendWhen(body, game);
    appendFacts(body, game);
    appendTeam(body, game);
    var table = isRecord(game.table) ? game.table : null;
    appendSplits(
      body,
      "Table",
      home,
      away,
      table ? tableBits(table.home) : "",
      table ? tableBits(table.away) : ""
    );
    appendSplits(body, "Last result", home, away, sideText(game.lastResult, "home"), sideText(game.lastResult, "away"));
    appendSplits(body, "Last-game cards", home, away, sideText(game.lastGameCards, "home"), sideText(game.lastGameCards, "away"));
    var kits = isRecord(game.kits) ? game.kits : null;
    appendSplits(
      body,
      "Kits",
      "Home",
      "Away",
      kits ? sideText(kits, "home") : "",
      kits ? sideText(kits, "away") : ""
    );
    if (kits && hasLine(kits.referee)) {
      var kitBlock = body.lastChild && body.lastChild.classList && body.lastChild.classList.contains("block")
        && body.lastChild.querySelector("h3")
        && body.lastChild.querySelector("h3").textContent === "Kits"
        ? body.lastChild
        : null;
      if (!kitBlock) {
        kitBlock = node("section", "block");
        kitBlock.appendChild(node("h3", "", "Kits"));
        body.appendChild(kitBlock);
      }
      var refKit = splitRow("Referee", kits.referee);
      if (refKit) kitBlock.appendChild(refKit);
    }
    appendPrep(body, game);
    appendRules(body, game);
    appendNotes(body, game);
    appendDetailSections(body, game);

    var edit = node("button", "edit-btn", "Edit");
    edit.type = "button";
    edit.setAttribute("data-action", "edit");
    edit.setAttribute("data-id", game.id);
    body.appendChild(edit);
    fold.appendChild(body);
    card.appendChild(fold);
    return card;
  }

  function field(name, label, type, value) {
    var lab = node("label");
    lab.appendChild(document.createTextNode(label));
    var input = document.createElement(type === "textarea" ? "textarea" : "input");
    input.name = name;
    if (type !== "textarea") input.type = type;
    if (type === "number") {
      input.inputMode = "decimal";
      input.step = "any";
    }
    if (value != null && value !== "") input.value = value;
    lab.appendChild(input);
    return lab;
  }

  function pair(a, b) {
    var wrap = node("div", "pair");
    wrap.appendChild(a);
    wrap.appendChild(b);
    return wrap;
  }

  function timingsText(game) {
    return timingsOf(game.prep).map(function (item) {
      var time = line(item.time);
      var label = line(item.label);
      return time && label ? time + " " + label : (time || label);
    }).join("\n");
  }

  function rulesText(game) {
    if (isRecord(game.prep) && typeof game.prep.rules === "string") return game.prep.rules;
    return rulesOf(game.prep).join("\n");
  }

  function timeValue(value) {
    var match = /^(\d{1,2}):(\d{2})$/.exec(line(value));
    if (!match) return "";
    if (+match[1] > 23) return "";
    return pad2(+match[1]) + ":" + match[2];
  }

  function numValue(value) {
    if (value == null || value === "") return "";
    if (typeof value === "number" && isFinite(value)) return String(value);
    if (typeof value === "string" && isFinite(Number(value.trim()))) return value.trim();
    return "";
  }

  function renderForm(game, isNew) {
    var card = node("section", "card");
    card.appendChild(node("h2", "section-title", isNew ? "Add game" : "Edit game"));
    var form = document.createElement("form");
    form.className = "game-form";
    form.setAttribute("data-action", "save");
    form.autocomplete = "off";
    form.setAttribute("data-id", isNew ? "" : game.id);

    var match = document.createElement("fieldset");
    match.appendChild(node("legend", "", "Match"));
    match.appendChild(field("competition", "Competition", "text", line(game.competition)));
    match.appendChild(pair(
      field("jornada", "Jornada", "number", numValue(game.jornada)),
      field("date", "Date", "date", /^\d{4}-\d{2}-\d{2}$/.test(line(game.date)) ? line(game.date) : "")
    ));
    match.appendChild(pair(
      field("time", "Time", "time", timeValue(game.time)),
      field("status", "Status", "text", "")
    ));
    var statusLabel = match.lastChild.querySelector("label:last-child");
    var statusInput = statusLabel.querySelector("input");
    statusLabel.removeChild(statusInput);
    var status = document.createElement("select");
    status.name = "status";
    var current = line(game.status) || "upcoming";
    ["upcoming", "done"].forEach(function (value) {
      var opt = node("option", "", value === "done" ? "Done" : "Upcoming");
      opt.value = value;
      status.appendChild(opt);
    });
    if (current !== "upcoming" && current !== "done") {
      var extra = node("option", "", current);
      extra.value = current;
      status.appendChild(extra);
    }
    status.value = current;
    statusLabel.appendChild(status);
    match.appendChild(pair(
      field("home", "Home", "text", line(game.home)),
      field("away", "Away", "text", line(game.away))
    ));
    form.appendChild(match);

    var place = document.createElement("fieldset");
    place.appendChild(node("legend", "", "Place"));
    place.appendChild(field("venue", "Venue", "text", line(game.venue)));
    place.appendChild(pair(
      field("aolCode", "AOL code", "text", line(game.aolCode)),
      field("role", "Role", "text", line(game.role))
    ));
    form.appendChild(place);

    var team = isRecord(game.team) ? game.team : {};
    var crew = document.createElement("fieldset");
    crew.appendChild(node("legend", "", "Referee team"));
    crew.appendChild(field("referee", "Referee", "text", personName(team.referee)));
    crew.appendChild(pair(
      field("aa1name", "AA1", "text", personName(team.aa1)),
      field("aa1phone", "AA1 phone", "tel", personPhone(team.aa1))
    ));
    crew.appendChild(pair(
      field("aa2name", "AA2", "text", personName(team.aa2)),
      field("aa2phone", "AA2 phone", "tel", personPhone(team.aa2))
    ));
    form.appendChild(crew);

    var table = isRecord(game.table) ? game.table : {};
    var homeTable = isRecord(table.home) ? table.home : {};
    var awayTable = isRecord(table.away) ? table.away : {};
    var standings = document.createElement("fieldset");
    standings.appendChild(node("legend", "", "Table"));
    standings.appendChild(pair(
      field("homePos", "Home position", "number", numValue(homeTable.pos)),
      field("homePts", "Home points", "number", numValue(homeTable.pts))
    ));
    standings.appendChild(pair(
      field("awayPos", "Away position", "number", numValue(awayTable.pos)),
      field("awayPts", "Away points", "number", numValue(awayTable.pts))
    ));
    form.appendChild(standings);

    var recent = document.createElement("fieldset");
    recent.appendChild(node("legend", "", "Recent"));
    recent.appendChild(field("lastHome", "Home last result", "text", sideText(game.lastResult, "home")));
    recent.appendChild(field("lastAway", "Away last result", "text", sideText(game.lastResult, "away")));
    recent.appendChild(field("cardsHome", "Home last-game cards", "text", sideText(game.lastGameCards, "home")));
    recent.appendChild(field("cardsAway", "Away last-game cards", "text", sideText(game.lastGameCards, "away")));
    form.appendChild(recent);

    var kits = isRecord(game.kits) ? game.kits : {};
    var kitSet = document.createElement("fieldset");
    kitSet.appendChild(node("legend", "", "Kits"));
    kitSet.appendChild(field("kitHome", "Home kit", "text", sideText(kits, "home")));
    kitSet.appendChild(field("kitAway", "Away kit", "text", sideText(kits, "away")));
    kitSet.appendChild(field("kitRef", "Referee kit", "text", sideText(kits, "referee")));
    form.appendChild(kitSet);

    var prep = document.createElement("fieldset");
    prep.appendChild(node("legend", "", "Prep"));
    var timings = field("timings", "Timings", "textarea", timingsText(game));
    timings.querySelector("textarea").placeholder = "14:30 Arrival";
    prep.appendChild(timings);
    var rules = field("rules", "Rules", "textarea", rulesText(game));
    rules.querySelector("textarea").placeholder = "One rule per line";
    prep.appendChild(rules);
    form.appendChild(prep);

    var notes = field("notes", "Notes", "textarea", typeof game.notes === "string" ? blockText(game.notes) : "");
    form.appendChild(notes);

    var actions = node("div", "form-actions");
    var save = node("button", "primary", isNew ? "Add game" : "Save");
    save.type = "submit";
    actions.appendChild(save);
    var cancel = node("button", "ghost", "Cancel");
    cancel.type = "button";
    cancel.setAttribute("data-action", "cancel");
    actions.appendChild(cancel);
    if (!isNew) {
      var del = node("button", "danger", "Delete");
      del.type = "button";
      del.setAttribute("data-action", "delete");
      del.setAttribute("data-id", game.id);
      actions.appendChild(del);
    }
    form.appendChild(actions);
    ["home", "away", "date"].forEach(function (name) {
      var input = form.querySelector("[name='" + name + "']");
      if (input) input.required = true;
    });
    card.appendChild(form);
    return card;
  }

  function renderList() {
    var games = (doc && doc.games) || [];
    var upcoming = games.filter(function (game) { return !isPast(game); }).sort(byDate("asc"));
    var past = games.filter(isPast).sort(byDate("desc"));

    els.main.appendChild(node("h2", "section-title", "Upcoming"));
    els.main.appendChild(addButton());
    if (!upcoming.length) {
      var empty = node("section", "card");
      empty.appendChild(node("p", "muted", "No upcoming games."));
      els.main.appendChild(empty);
    }
    var upcomingWrap = node("div", "");
    upcomingWrap.id = "upcoming";
    upcoming.forEach(function (game) {
      upcomingWrap.appendChild(renderCard(game, false));
    });
    els.main.appendChild(upcomingWrap);

    if (past.length) {
      var details = document.createElement("details");
      details.className = "past";
      details.id = "past-games";
      details.open = pastOpen;
      var summary = document.createElement("summary");
      summary.appendChild(document.createTextNode("Past games"));
      summary.appendChild(node("span", "count", String(past.length)));
      details.appendChild(summary);
      past.forEach(function (game) {
        details.appendChild(renderCard(game, true));
      });
      els.main.appendChild(details);
    }
  }

  function render() {
    if (!els.main) return;
    var pastEl = document.getElementById("past-games");
    if (pastEl) pastOpen = pastEl.open;
    document.querySelectorAll(".match-fold").forEach(function (el) {
      var id = el.parentElement && el.parentElement.getAttribute("data-game-id");
      if (id) openGames[id] = el.open;
    });
    document.querySelectorAll(".subdetails[data-sub]").forEach(function (el) {
      openSubs[el.getAttribute("data-sub")] = el.open;
    });
    var y = jumpTop ? 0 : window.scrollY;
    if (!hasToken()) {
      renderEmpty("Your games stay private. Connect sync to load them on this device.");
      return;
    }
    if (!doc) {
      renderEmpty(loadNote || "Loading games…");
      return;
    }
    clear(els.main);
    if (mode.type === "new") {
      els.main.appendChild(renderForm({}, true));
    } else if (mode.type === "edit") {
      var game = findGame(mode.id);
      if (!game) mode = { type: "list" };
      else els.main.appendChild(renderForm(game, false));
    }
    if (mode.type === "list") renderList();
    window.scrollTo(0, y);
    if (jumpTop) {
      var input = els.main.querySelector(".game-form input, .game-form textarea, .game-form select");
      if (input) input.focus();
    }
  }

  function fail(err) {
    var message = err && err.message ? err.message : String(err);
    if (els.sync) els.sync.textContent = "⚠️ " + message;
    if (/No GitHub token|token rejected|Not synced/i.test(message)) loadNote = "";
    showConnect();
    if (!hasToken()) render();
  }

  function pushNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!doc || !hasToken() || !window.GhSync) return;
    if (saving) {
      saveAgain = true;
      return;
    }
    saving = true;
    inSave = true;
    if (els.sync) els.sync.textContent = "☁️ Saving…";
    GhSync.save(APP_ID, function () {
      return doc;
    }, applyRemote, { quiet: true }).then(function () {
      saving = false;
      inSave = false;
      retried = false;
      if (!saveAgain) dirty = false;
      if (els.sync) els.sync.textContent = "✅ Saved " + hhmm();
      if (saveAgain) {
        saveAgain = false;
        pushNow();
      }
    }, function (err) {
      saving = false;
      inSave = false;
      fail(err);
      if (!retried && /another device|409/.test(String(err && err.message))) {
        retried = true;
        saveTimer = setTimeout(pushNow, 3000);
      }
    });
  }

  function touch() {
    if (!doc) return;
    doc.updatedAt = new Date().toISOString();
    if (doc.version == null) doc.version = 1;
    mode = { type: "list" };
    dirty = true;
    retried = false;
    render();
    if (!hasToken()) {
      if (els.sync) els.sync.textContent = "📴 Not synced";
      showConnect();
      return;
    }
    pushNow();
  }

  function applyRemote(remote) {
    if (inSave) return;
    if (!isRecord(remote)) return;
    doc = normalize(remote);
    dirty = false;
    loadNote = "";
    if (mode.type === "edit" && !findGame(mode.id)) mode = { type: "list" };
    render();
  }

  function autoLoad() {
    showConnect();
    if (!hasToken()) {
      doc = null;
      loadNote = "";
      mode = { type: "list" };
      if (els.sync) els.sync.textContent = "📴 Not synced";
      render();
      return;
    }
    if (loading || saving || saveTimer || dirty || mode.type !== "list") return;
    var active = document.activeElement;
    if (active && active.closest && (active.closest("#main form") || active.closest(".self-note, .check"))) return;
    loading = true;
    GhSync.load(APP_ID, applyRemote).then(function (msg) {
      loading = false;
      if (!doc) {
        doc = normalize({ version: 1, updatedAt: null, games: [] });
        loadNote = msg || "Nothing saved on GitHub yet";
        if (els.sync) els.sync.textContent = loadNote;
        render();
      } else if (els.sync && !dirty) {
        els.sync.textContent = "☁️ Synced " + hhmm();
      }
      showConnect();
    }, function (err) {
      loading = false;
      loadNote = err && err.message ? err.message : "Could not load";
      if (!doc) render();
      fail(err);
    });
  }

  function formValue(form, name) {
    var data = new FormData(form);
    return data.get(name) == null ? "" : String(data.get(name));
  }

  function readNumber(raw) {
    var value = line(raw);
    if (!value) return { ok: true, value: null };
    var n = Number(value);
    if (!isFinite(n)) return { ok: false, value: null };
    return { ok: true, value: n };
  }

  function assignLine(game, key, raw, original) {
    var value = line(raw);
    if (value) game[key] = value;
    else if (original && isRecord(original[key])) game[key] = original[key];
    else game[key] = null;
  }

  function assistant(originalPerson, nameRaw, phoneRaw) {
    var name = line(nameRaw);
    var phone = line(phoneRaw);
    var base = isRecord(originalPerson) ? JSON.parse(JSON.stringify(originalPerson)) : {};
    if (name) base.name = name;
    else if (!isRecord(base.name)) base.name = null;
    if (phone) base.phone = phone;
    else if (!isRecord(base.phone)) base.phone = null;
    return base;
  }

  function nestedText(originalGroup, key, raw) {
    var value = line(raw);
    if (value) return value;
    if (isRecord(originalGroup) && isRecord(originalGroup[key])) return originalGroup[key];
    return null;
  }

  function readGame(form, original) {
    var home = line(formValue(form, "home"));
    var away = line(formValue(form, "away"));
    var date = line(formValue(form, "date"));
    if (!home || !away || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { error: "Add a date, home team, and away team" };
    }
    var timeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(line(formValue(form, "time")));
    if (line(formValue(form, "time")) && (!timeMatch || +timeMatch[1] > 23 || +timeMatch[2] > 59)) {
      return { error: "Check the kickoff time" };
    }
    var time = timeMatch ? pad2(+timeMatch[1]) + ":" + timeMatch[2] : "";
    var numbers = {
      jornada: readNumber(formValue(form, "jornada")),
      homePos: readNumber(formValue(form, "homePos")),
      homePts: readNumber(formValue(form, "homePts")),
      awayPos: readNumber(formValue(form, "awayPos")),
      awayPts: readNumber(formValue(form, "awayPts"))
    };
    var bad = Object.keys(numbers).some(function (key) { return !numbers[key].ok; });
    if (bad) return { error: "Check the numbers" };

    var game = isRecord(original) ? JSON.parse(JSON.stringify(original)) : {};
    var currentId = line(form.getAttribute("data-id"));
    game.id = currentId || uniqueId(date, home, away, "");
    assignLine(game, "competition", formValue(form, "competition"), original);
    if (numbers.jornada.value == null && original && original.jornada != null && typeof original.jornada === "object") {
      game.jornada = original.jornada;
    } else {
      game.jornada = numbers.jornada.value;
    }
    game.date = date;
    game.time = time || null;
    game.home = home;
    game.away = away;
    game.status = line(formValue(form, "status")) || "upcoming";
    assignLine(game, "venue", formValue(form, "venue"), original);
    assignLine(game, "aolCode", formValue(form, "aolCode"), original);
    assignLine(game, "role", formValue(form, "role"), original);

    var origTeam = isRecord(original && original.team) ? original.team : {};
    game.team = isRecord(game.team) ? game.team : {};
    var referee = line(formValue(form, "referee"));
    if (referee) game.team.referee = referee;
    else if (isRecord(origTeam.referee)) game.team.referee = origTeam.referee;
    else game.team.referee = null;
    game.team.aa1 = assistant(origTeam.aa1, formValue(form, "aa1name"), formValue(form, "aa1phone"));
    game.team.aa2 = assistant(origTeam.aa2, formValue(form, "aa2name"), formValue(form, "aa2phone"));

    var origTable = isRecord(original && original.table) ? original.table : {};
    game.table = {
      home: { pos: numbers.homePos.value, pts: numbers.homePts.value },
      away: { pos: numbers.awayPos.value, pts: numbers.awayPts.value }
    };
    ["home", "away"].forEach(function (side) {
      if (isRecord(origTable[side])) {
        Object.keys(origTable[side]).forEach(function (key) {
          if (key !== "pos" && key !== "pts" && game.table[side][key] == null) {
            game.table[side][key] = origTable[side][key];
          }
        });
      }
    });

    game.lastResult = {
      home: nestedText(original && original.lastResult, "home", formValue(form, "lastHome")),
      away: nestedText(original && original.lastResult, "away", formValue(form, "lastAway"))
    };
    game.lastGameCards = {
      home: nestedText(original && original.lastGameCards, "home", formValue(form, "cardsHome")),
      away: nestedText(original && original.lastGameCards, "away", formValue(form, "cardsAway"))
    };
    game.kits = {
      home: nestedText(original && original.kits, "home", formValue(form, "kitHome")),
      away: nestedText(original && original.kits, "away", formValue(form, "kitAway")),
      referee: nestedText(original && original.kits, "referee", formValue(form, "kitRef"))
    };

    var origPrep = isRecord(original && original.prep) ? original.prep : {};
    var timingRaw = blockText(formValue(form, "timings"));
    var rulesRaw = blockText(formValue(form, "rules"));
    var sameTimings = timingRaw === timingsText(original || {});
    var sameRules = rulesRaw === blockText(rulesText(original || {}));
    game.prep = isRecord(game.prep) ? game.prep : {};
    if (!sameTimings) {
      game.prep.timings = timingRaw ? timingRaw.split("\n").map(function (row) {
        var trimmed = row.trim();
        if (!trimmed) return null;
        var match = /^(\d{1,2}:\d{2})\s+(.+)$/.exec(trimmed);
        if (match) return { time: match[1], label: line(match[2]) };
        var onlyTime = /^(\d{1,2}:\d{2})$/.exec(trimmed);
        if (onlyTime) return { time: onlyTime[1], label: null };
        return { time: null, label: line(trimmed) };
      }).filter(Boolean) : [];
    } else if (origPrep.timings != null) {
      game.prep.timings = origPrep.timings;
    }
    if (!sameRules) {
      game.prep.rules = rulesRaw ? rulesRaw.split("\n").map(line).filter(Boolean) : [];
    } else if (origPrep.rules != null) {
      game.prep.rules = origPrep.rules;
    }
    Object.keys(origPrep).forEach(function (key) {
      if (key !== "timings" && key !== "rules" && game.prep[key] == null) game.prep[key] = origPrep[key];
    });

    var notesRaw = blockText(formValue(form, "notes"));
    if (notesRaw) game.notes = notesRaw;
    else if (original && original.notes != null && typeof original.notes !== "string") game.notes = original.notes;
    else game.notes = null;
    return { game: game };
  }

  function upsert(game, previousId) {
    if (!Array.isArray(doc.games)) doc.games = [];
    var idx = -1;
    doc.games.forEach(function (item, i) {
      if (item && item.id === previousId) idx = i;
    });
    if (idx >= 0) doc.games[idx] = game;
    else doc.games.push(game);
  }

  function onMainClick(e) {
    var t = e.target;
    if (t && t.nodeType !== 1) t = t.parentElement;
    if (!t || !t.closest) return;
    var btn = t.closest("[data-action]");
    if (!btn || !els.main.contains(btn)) return;
    var action = btn.getAttribute("data-action");
    if (action === "add") {
      if (!doc) doc = normalize({ version: 1, games: [] });
      mode = { type: "new" };
      jumpTop = true;
      render();
      jumpTop = false;
      return;
    }
    if (action === "edit") {
      mode = { type: "edit", id: btn.getAttribute("data-id") };
      jumpTop = true;
      render();
      jumpTop = false;
      return;
    }
    if (action === "cancel") {
      mode = { type: "list" };
      render();
      return;
    }
    if (action === "delete") {
      if (!doc || !window.confirm("Delete this game?")) return;
      var id = btn.getAttribute("data-id");
      doc.games = (doc.games || []).filter(function (game) {
        return game && game.id !== id;
      });
      touch();
    }
  }

  function onMainSubmit(e) {
    var form = e.target;
    if (!form || !form.getAttribute || form.getAttribute("data-action") !== "save") return;
    e.preventDefault();
    if (!doc) doc = normalize({ version: 1, games: [] });
    var previousId = line(form.getAttribute("data-id"));
    var original = previousId ? findGame(previousId) : {};
    var result = readGame(form, original || {});
    if (result.error) {
      if (els.sync) els.sync.textContent = "⚠️ " + result.error;
      return;
    }
    upsert(result.game, previousId);
    touch();
  }

  function indexCrests(data) {
    crestByNorm = {};
    if (!isRecord(data)) return;
    Object.keys(data).forEach(function (name) {
      var file = data[name];
      if (typeof file !== "string") return;
      var base = file.split("/").pop();
      if (!/^[a-z0-9][a-z0-9.-]{0,80}\.(webp|png)$/.test(base)) return;
      var key = normClub(name);
      if (key) crestByNorm[key] = base;
    });
  }

  function loadExtras() {
    fetch("data/game-extras.json")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        indexExtras(data);
        if (doc && mode.type === "list") render();
      })
      .catch(function () {
        extras = null;
        venueByNorm = {};
        clubByNorm = {};
      });
  }

  function loadCrests() {
    fetch("assets/crests/crests.json")
      .then(function (res) {
        return res.ok ? res.json() : {};
      })
      .then(function (data) {
        indexCrests(data);
        if (doc && mode.type === "list") render();
      })
      .catch(function () {
        crestByNorm = {};
      });
  }

  function tickCountdowns() {
    document.querySelectorAll("[data-countdown]").forEach(function (el) {
      var ms = Number(el.getAttribute("data-countdown"));
      el.textContent = countdownLabel(ms);
      el.className = countdownClass(ms);
    });
    document.querySelectorAll("[data-row-count]").forEach(function (el) {
      el.textContent = rowCountText({
        date: el.getAttribute("data-date"),
        time: el.getAttribute("data-time"),
        status: el.getAttribute("data-status")
      });
    });
  }

  if (!els.main || !window.GhSync || typeof GhSync.load !== "function") {
    if (els.sync) els.sync.textContent = "GitHub sync failed to load.";
    if (els.main) renderEmpty("GitHub sync failed to load.");
    return;
  }

  els.main.addEventListener("click", onMainClick);
  els.main.addEventListener("submit", onMainSubmit);
  if (els.connectBtn) {
    els.connectBtn.addEventListener("click", function () {
      GhSync.load(APP_ID, applyRemote).then(function (msg) {
        showConnect();
        if (!doc) {
          doc = normalize({ version: 1, updatedAt: null, games: [] });
          loadNote = msg || "Nothing saved on GitHub yet";
          if (els.sync) els.sync.textContent = loadNote;
          render();
        } else if (els.sync) {
          els.sync.textContent = "☁️ Synced " + hhmm();
        }
      }, fail);
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && (saveTimer || dirty)) pushNow();
    if (document.visibilityState === "visible") autoLoad();
  });
  window.addEventListener("focus", autoLoad);

  showConnect();
  render();
  loadCrests();
  loadExtras();
  setInterval(autoLoad, 60000);
  setInterval(tickCountdowns, 15000);
  autoLoad();
})();
