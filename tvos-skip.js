(function () {
    'use strict';

    if (window.nfx_skip_plugin) return;
    window.nfx_skip_plugin = true;

    var DB_URL = 'https://raw.githubusercontent.com/ipavlin98/lmp-series-skip-db/refs/heads/main/database/';
    var ANISKIP_API = 'https://api.aniskip.com/v2/skip-times';
    var ANILIST_API = 'https://graphql.anilist.co';
    var JIKAN_API = 'https://api.jikan.moe/v4/anime';

    /* ------------------------------------------------------------------ *
     *  Налаштування
     * ------------------------------------------------------------------ */

    function opt(key, def) {
        try {
            var v = Lampa.Storage.get(key, def);
            if (v === undefined || v === null || v === '') return def;
            return v;
        } catch (e) {
            return def;
        }
    }

    function flag(key, def) {
        var v = opt(key, def);
        return v === true || v === 'true' || v === 1 || v === '1';
    }

    function num(key, def) {
        var v = parseFloat(opt(key, def));
        return isNaN(v) ? parseFloat(def) : v;
    }

    function noty(text) {
        if (!flag('nfx_skip_noty', 'true')) return;
        try { Lampa.Noty.show('NFX Skip: ' + text); } catch (e) {}
    }

    function log() {
        try { console.log.apply(console, ['NFX Skip'].concat(Array.prototype.slice.call(arguments))); } catch (e) {}
    }

    function initSettings() {
        if (!Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: 'nfx_skip',
            name: 'NFX Skip',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>'
        });

        function param(name, values, def, title, descr) {
            Lampa.SettingsApi.addParam({
                component: 'nfx_skip',
                param: { name: name, type: 'select', values: values, default: def },
                field: { name: title, description: descr }
            });
        }

        param('nfx_skip_intro_mode',
            { button: 'Кнопка (Netflix)', auto: 'Автоматично, без кнопки', off: 'Вимкнено' },
            'button',
            'Пропуск заставки',
            'Що робити на початку інтро');

        param('nfx_skip_credits_mode',
            { next: 'Наступна серія / закрити', button: 'Кнопка (Netflix)', off: 'Вимкнено' },
            'next',
            'Пропуск титрів',
            'Що робити на фінальних титрах');

        param('nfx_skip_wait',
            { 3: '3 секунди', 4: '4 секунди', 5: '5 секунд', 8: '8 секунд' },
            '4',
            'Заповнення кнопки',
            'Скільки кнопка заповнюється білим до автопропуску');

        param('nfx_skip_movie_tail',
            { off: 'Вимкнено', 180: 'за 3 хв до кінця', 300: 'за 5 хв до кінця', 420: 'за 7 хв до кінця', 600: 'за 10 хв до кінця' },
            '300',
            'Титри у фільмах',
            'Для фільмів немає бази міток — позиція титрів рахується від тривалості');

        param('nfx_skip_anime',
            { true: 'Увімкнено', false: 'Вимкнено' },
            'true',
            'Аніме через AniSkip',
            'Додаткове джерело міток для аніме (опенінг/ендінг)');

        param('nfx_skip_button_style',
            { nfx: 'Своя кнопка (Netflix)', lampa: 'Вбудована кнопка Lampa' },
            'nfx',
            'Вигляд кнопки',
            'Тільки для вбудованого веб-плеєра Lampa. На tvOS Pro кнопку малює сам додаток');

        param('nfx_skip_demo',
            { false: 'Вимкнено', true: 'Увімкнено' },
            'false',
            'Тестовий режим',
            'Ставить інтро 10-40 сек і титри за 60 сек до кінця на будь-якому відео');

        param('nfx_skip_noty',
            { true: 'Показувати', false: 'Не показувати' },
            'true',
            'Повідомлення',
            'Сповіщення про знайдені мітки та ID');
    }

    /* ------------------------------------------------------------------ *
     *  Робота з мітками
     * ------------------------------------------------------------------ */

    function toSeg(raw) {
        var start = parseFloat(raw.start);
        var end = parseFloat(raw.end);
        if (isNaN(start) || isNaN(end) || end <= start) return null;
        return { start: start, end: end, name: raw.name || 'Пропустити' };
    }

    function normalize(list) {
        if (!Array.isArray(list)) return [];
        var out = [];
        list.forEach(function (raw) {
            var seg = toSeg(raw || {});
            if (seg) out.push(seg);
        });
        return out.sort(function (a, b) { return a.start - b.start; });
    }

    // Титри чи інтро. duration може бути 0 — тоді тільки за назвою.
    function isCredits(seg, duration) {
        var name = (seg.name || '').toLowerCase();
        if (name.indexOf('титр') !== -1 || name.indexOf('credit') !== -1 ||
            name.indexOf('ендінг') !== -1 || name.indexOf('эндинг') !== -1 ||
            name.indexOf('ending') !== -1) return true;
        if (duration > 0) return seg.start >= duration * 0.7 || seg.end >= duration - 15;
        return false;
    }

    function hasSegments(obj) {
        return !!(obj && obj.segments && obj.segments.skip && obj.segments.skip.length);
    }

    /* ------------------------------------------------------------------ *
     *  Джерела
     * ------------------------------------------------------------------ */

    function kpId(card) {
        if (!card) return null;
        return card.kinopoisk_id || card.kp_id ||
            (card.source === 'kinopoisk' || card.source === 'kp' ? card.id : null) || null;
    }

    function fetchJson(url, opts) {
        return fetch(url, opts).then(function (res) {
            if (!res.ok) return null;
            return res.json();
        })['catch'](function () { return null; });
    }

    function fromDb(db, season, episode) {
        if (!db) return null;
        var s = String(season);
        var e = String(episode);
        if (db[s] && db[s][e]) return db[s][e];
        if (db.movie) return db.movie;
        return null;
    }

    function isAnime(card) {
        if (!card) return false;
        var lang = (card.original_language || '').toLowerCase();
        if (lang === 'ja' || lang === 'zh' || lang === 'cn') return true;
        return !!(card.genres && card.genres.some(function (g) {
            return g.id === 16 || (g.name && g.name.toLowerCase() === 'animation');
        }));
    }

    function malId(title, season, year) {
        var q = title + (season > 1 ? ' Season ' + season : '');
        var gql = 'query ($search: String) { Page(page: 1, perPage: 10) { media(search: $search, type: ANIME) { idMal seasonYear } } }';

        return fetchJson(ANILIST_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: gql, variables: { search: q } })
        }).then(function (json) {
            var list = json && json.data && json.data.Page && json.data.Page.media;
            list = (list || []).filter(function (i) { return i.idMal; });
            if (!list.length) return null;
            if (year && season === 1) {
                var hit = list.find(function (i) { return String(i.seasonYear) === String(year); });
                if (hit) return hit.idMal;
            }
            return list[0].idMal;
        }).then(function (id) {
            if (id) return id;
            return fetchJson(JIKAN_API + '?q=' + encodeURIComponent(q) + '&limit=5').then(function (json) {
                if (!json || !json.data || !json.data.length) return null;
                return json.data[0].mal_id;
            });
        });
    }

    function aniskip(mal, episode) {
        var url = ANISKIP_API + '/' + mal + '/' + episode + '?types=op&types=ed&types=recap&episodeLength=0';
        return fetchJson(url).then(function (data) {
            if (!data || !data.found || !data.results) return [];
            return data.results.map(function (r) {
                if (!r.interval) return null;
                var type = (r.skipType || r.skip_type || '').toLowerCase();
                var name = type === 'op' ? 'Пропустити опенінг' : (type === 'ed' ? 'Пропустити титри' : 'Пропустити рекап');
                var s = r.interval.startTime !== undefined ? r.interval.startTime : r.interval.start_time;
                var e = r.interval.endTime !== undefined ? r.interval.endTime : r.interval.end_time;
                if (s === undefined || e === undefined) return null;
                return { start: s, end: e, name: name };
            }).filter(Boolean);
        });
    }

    /* ------------------------------------------------------------------ *
     *  Розбір даних плеєра
     * ------------------------------------------------------------------ */

    function getCard(data) {
        var card = data.movie || data.card;
        if (!card && Lampa.Activity) {
            var act = Lampa.Activity.active();
            if (act) card = act.movie || act.card;
        }
        return card || null;
    }

    function getPosition(data) {
        if (data.episode || data.e || data.episode_number) {
            return {
                season: parseInt(data.season || data.s || 1) || 1,
                episode: parseInt(data.episode || data.e || data.episode_number) || 1
            };
        }
        if (data.playlist && Array.isArray(data.playlist)) {
            var i = data.playlist.findIndex(function (p) { return p.url && p.url === data.url; });
            if (i !== -1) {
                var item = data.playlist[i];
                return {
                    season: parseInt(item.season || item.s || 1) || 1,
                    episode: parseInt(item.episode || item.e || item.episode_number || i + 1) || 1
                };
            }
        }
        return { season: 1, episode: 1 };
    }

    function isSerial(card, data) {
        if (!card) return false;
        if (card.number_of_seasons > 0) return true;
        if (data && (data.episode || data.e || data.episode_number)) return true;
        return !!(card.original_name && !card.original_title);
    }

    // Тривалість фільму в секундах з картки TMDB
    function runtimeSec(card) {
        if (!card) return 0;
        var r = parseFloat(card.runtime || (card.movie && card.movie.runtime));
        if (!isNaN(r) && r > 0) return r * 60;
        return 0;
    }

    // Куди піде відео: у вбудований веб-плеєр Lampa чи в зовнішній (tvOS Pro, Infuse, VLC...)
    function isExternal(data) {
        try {
            var need = 'player' + (data.torrent_hash ? '_torrent' : '');
            var player = data.launch_player || Lampa.Storage.field(need);
            if (player === 'inner' || player === 'lampa') return false;
            if (Lampa.PlayerVideo.verifyTube && Lampa.PlayerVideo.verifyTube(data.url)) return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    /* ------------------------------------------------------------------ *
     *  Збір міток для поточного відео
     * ------------------------------------------------------------------ */

    var marks = { intro: null, credits: null, duration: 0, serial: false, ready: false };

    function resetMarks() {
        marks = { intro: null, credits: null, duration: 0, serial: false, ready: false };
    }

    function splitSegments(list, duration) {
        var res = { intro: null, credits: null };
        normalize(list).forEach(function (seg) {
            if (isCredits(seg, duration)) {
                if (!res.credits || seg.start < res.credits.start) res.credits = seg;
            } else if (!res.intro) {
                res.intro = seg;
            }
        });
        return res;
    }

    function collect(data) {
        var card = getCard(data);
        var pos = getPosition(data);
        var serial = isSerial(card, data);
        var duration = serial ? 0 : runtimeSec(card);

        if (flag('nfx_skip_demo', 'false')) {
            var demo = { intro: { start: 10, end: 40, name: 'Пропустити заставку' }, credits: null, duration: 0, serial: serial };
            noty('демо-режим, інтро 10-40 сек');
            return Promise.resolve(demo);
        }

        if (!card) return Promise.resolve({ intro: null, credits: null, duration: 0, serial: serial });

        var id = kpId(card);
        var chain = Promise.resolve([]);

        if (id) {
            chain = fetchJson(DB_URL + id + '.json').then(function (db) {
                var list = fromDb(db, pos.season, serial ? pos.episode : 1);
                return list || [];
            });
        }

        return chain.then(function (list) {
            if (list.length || !serial || !flag('nfx_skip_anime', 'true')) return list;
            if (!isAnime(card)) return list;
            var title = card.original_name || card.original_title || card.name || card.title || '';
            var year = (card.first_air_date || card.release_date || '').slice(0, 4);
            return malId(title.replace(/[:\-]/g, ' ').trim(), pos.season, year).then(function (mal) {
                if (!mal) return [];
                return aniskip(mal, pos.episode);
            });
        }).then(function (list) {
            var res = splitSegments(list, duration);
            res.duration = duration;
            res.serial = serial;

            // Фільм без міток у базі: рахуємо титри від тривалості
            var tail = opt('nfx_skip_movie_tail', '300');
            if (!serial && !res.credits && tail !== 'off' && tail !== false && duration > 0) {
                var start = duration - parseFloat(tail);
                if (start > 60) res.credits = { start: start, end: duration, name: 'Пропустити титри' };
            }

            if (res.intro || res.credits) {
                noty((serial ? 'S' + pos.season + 'E' + pos.episode : 'фільм') + ' — мітки знайдено');
            } else if (serial && !id) {
                noty('немає kinopoisk_id у картці, мітки серіалу недоступні');
            }

            log('marks', res, 'id', id, 'serial', serial, 'duration', duration);
            return res;
        })['catch'](function (e) {
            log('collect error', e);
            return { intro: null, credits: null, duration: duration, serial: serial };
        });
    }

    /* ------------------------------------------------------------------ *
     *  Netflix-кнопка для вбудованого веб-плеєра
     * ------------------------------------------------------------------ */

    function initStyle() {
        var css = document.createElement('style');
        css.textContent = [
            '.nfx-skip{position:absolute;right:2.4em;bottom:2.4em;z-index:200;',
            'display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;',
            'padding:.75em 1.8em;border:.12em solid #fff;border-radius:.25em;',
            'background:rgba(20,20,20,.55);color:#fff;font-size:1.35em;font-weight:700;',
            'overflow:hidden;cursor:pointer;',
            '-webkit-transition:bottom .3s,opacity .2s,-webkit-transform .2s;transition:bottom .3s,opacity .2s,transform .2s}',
            '.nfx-skip.hide{display:none}',
            '.nfx-skip__fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:#fff;',
            '-webkit-transform:scaleX(0);transform:scaleX(0);',
            '-webkit-transform-origin:left center;transform-origin:left center}',
            '.nfx-skip__fill--run{-webkit-transform:scaleX(1);transform:scaleX(1)}',
            '.nfx-skip__label{position:relative;z-index:2;white-space:nowrap;',
            'mix-blend-mode:difference;color:#fff}',
            '.nfx-skip.focus{-webkit-transform:scale(1.06);transform:scale(1.06);',
            'box-shadow:0 0 0 .12em #fff}',
            '.player--panel-visible .nfx-skip{bottom:12em}'
        ].join('');
        document.head.appendChild(css);
    }

    var $btn = null;
    var btn_timer = null;
    var btn_action = null;

    function hideButton() {
        if (btn_timer) { clearTimeout(btn_timer); btn_timer = null; }
        btn_action = null;
        if ($btn) { $btn.remove(); $btn = null; }
        try {
            if (Lampa.Controller.enabled() && Lampa.Controller.enabled().name === 'nfx_skip') {
                Lampa.Controller.toggle('player');
            }
        } catch (e) {}
    }

    function addController() {
        Lampa.Controller.add('nfx_skip', {
            toggle: function () {
                var html = Lampa.Player.render();
                Lampa.Controller.collectionSet(html);
                if ($btn) Lampa.Controller.collectionFocus($btn[0], html);
            },
            up: function () {
                if (Lampa.PlayerPanel.visibleStatus()) Lampa.PlayerPanel.hide();
                else Lampa.PlayerPanel.reveal();
            },
            down: function () { Lampa.PlayerPanel.toggle(); },
            left: function () { Lampa.Player.toggle(); },
            right: function () { Lampa.Player.toggle(); },
            gone: function () { if ($btn) $btn.removeClass('focus'); },
            back: function () { Lampa.Player.close(); }
        });
    }

    function showButton(title, wait, action) {
        if ($btn) return;

        btn_action = action;

        $btn = $('<div class="nfx-skip selector">' +
            '<div class="nfx-skip__fill"></div>' +
            '<div class="nfx-skip__label">' + title + '</div>' +
            '</div>');

        $btn.on('hover:enter click', function () {
            var run = btn_action;
            hideButton();
            if (run) run();
        });

        $(Lampa.Player.render()).append($btn);

        var $fill = $btn.find('.nfx-skip__fill');
        $fill.css({
            '-webkit-transition': '-webkit-transform ' + wait + 's linear',
            transition: 'transform ' + wait + 's linear'
        });
        // reflow, інакше transition склеїться в один кадр
        $fill[0].offsetWidth;
        $fill.addClass('nfx-skip__fill--run');

        try {
            if (Lampa.Controller.enabled() && Lampa.Controller.enabled().name === 'player') {
                Lampa.Controller.toggle('nfx_skip');
            }
        } catch (e) {}

        if (wait > 0) {
            btn_timer = setTimeout(function () {
                var run = btn_action;
                hideButton();
                if (run) run();
            }, wait * 1000);
        }
    }

    /* ------------------------------------------------------------------ *
     *  Дії
     * ------------------------------------------------------------------ */

    function seekTo(sec) {
        try {
            var video = Lampa.PlayerVideo.video();
            var dur = video ? video.duration || 0 : 0;
            Lampa.PlayerVideo.to(dur ? Math.min(sec, dur - 1) : sec);
        } catch (e) { log('seek error', e); }
    }

    function finish() {
        try {
            if (marks.serial && Lampa.PlayerPlaylist.canNext && Lampa.PlayerPlaylist.canNext()) {
                Lampa.PlayerPlaylist.next();
            } else {
                Lampa.Player.close();
            }
        } catch (e) {
            try { Lampa.Player.close(); } catch (e2) {}
        }
    }

    /* ------------------------------------------------------------------ *
     *  Спостереження за часом (вбудований плеєр)
     * ------------------------------------------------------------------ */

    var done = { intro: false, credits: false };

    function watch(e) {
        if (!marks.ready) return;
        if (opt('nfx_skip_button_style', 'nfx') !== 'nfx') return;

        var time = e.current || 0;
        var duration = e.duration || 0;
        if (!time) return;

        var wait = num('nfx_skip_wait', '4');
        var intro_mode = opt('nfx_skip_intro_mode', 'button');
        var credits_mode = opt('nfx_skip_credits_mode', 'next');

        if (marks.intro && !done.intro && intro_mode !== 'off') {
            if (time >= marks.intro.start && time < marks.intro.end - 1) {
                if (intro_mode === 'auto') {
                    done.intro = true;
                    seekTo(marks.intro.end);
                    noty('заставку пропущено');
                } else {
                    showButton(marks.intro.name || 'Пропустити заставку', wait, function () {
                        done.intro = true;
                        seekTo(marks.intro.end);
                    });
                }
            } else if (time >= marks.intro.end) {
                done.intro = true;
                if (btn_action) hideButton();
            }
        }

        // Титри у фільмі, де мітка порахована від тривалості картки:
        // якщо реальний файл довший/коротший — підганяємо під фактичну тривалість
        if (marks.credits && duration > 0 && marks.duration > 0 && Math.abs(duration - marks.duration) > 10) {
            var shift = duration - marks.duration;
            marks.credits = {
                start: Math.max(60, marks.credits.start + shift),
                end: duration,
                name: marks.credits.name
            };
            marks.duration = duration;
        }

        if (marks.credits && !done.credits && credits_mode !== 'off' && time >= marks.credits.start) {
            if (credits_mode === 'next') {
                done.credits = true;
                hideButton();
                finish();
            } else {
                showButton(marks.credits.name || 'Пропустити титри', wait, function () {
                    done.credits = true;
                    finish();
                });
            }
        }
    }

    /* ------------------------------------------------------------------ *
     *  Підміна Lampa.Player.play
     * ------------------------------------------------------------------ */

    function segmentsFor(res) {
        var skip = [];
        if (res.intro) skip.push({ start: res.intro.start, end: res.intro.end, name: res.intro.name });
        if (res.credits) skip.push({ start: res.credits.start, end: res.credits.end, name: res.credits.name });
        if (!skip.length) return null;
        var out = { skip: skip };
        if (res.duration > 0) out.duration_ms = res.duration * 1000;
        return out;
    }

    function apply(data, res) {
        marks = {
            intro: res.intro,
            credits: res.credits,
            duration: res.duration || 0,
            serial: !!res.serial,
            ready: true
        };
        done = { intro: false, credits: false };

        var external = isExternal(data);
        var native_ui = external || opt('nfx_skip_button_style', 'nfx') !== 'nfx';
        if (!native_ui) return;

        // Зовнішній плеєр (tvOS Pro, Infuse...) отримує мітки в lampa://video?...&segments=
        // Вбудований плеєр з режимом "кнопка Lampa" — через штатний модуль Segments
        var segments = segmentsFor(res);
        if (!segments) return;
        if (hasSegments(data)) return;

        data.segments = segments;
        marks.ready = false;

        if (data.playlist && Array.isArray(data.playlist)) {
            data.playlist.forEach(function (item) {
                if (item.url === data.url && !hasSegments(item)) item.segments = segments;
            });
        }
    }

    function initPlayer() {
        var original_play = Lampa.Player.play;
        var original_playlist = Lampa.Player.playlist;
        var pending = null;

        Lampa.Player.playlist = function (list) {
            pending = list;
            original_playlist.call(this, list);
        };

        Lampa.Player.play = function (data) {
            var ctx = this;

            var run = function () {
                original_play.call(ctx, data);
                if (pending) {
                    try { Lampa.PlayerPlaylist.set(pending); } catch (e) {}
                    pending = null;
                }
            };

            resetMarks();

            if (!data || !data.url) return run();

            try {
                if (data.url) Lampa.PlayerPlaylist.url(data.url);
                if (data.playlist && data.playlist.length) Lampa.PlayerPlaylist.set(data.playlist);
            } catch (e) {}

            collect(data).then(function (res) {
                try { apply(data, res); } catch (e) { log('apply error', e); }
                run();
            })['catch'](function (e) {
                log('play error', e);
                run();
            });
        };

        Lampa.PlayerVideo.listener.follow('timeupdate', function (e) {
            try { watch(e); } catch (err) { log('watch error', err); }
        });

        Lampa.Player.listener.follow('destroy', function () {
            hideButton();
            resetMarks();
        });
    }

    /* ------------------------------------------------------------------ *
     *  Старт
     * ------------------------------------------------------------------ */

    function start() {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo) return;
        initStyle();
        initSettings();
        addController();
        initPlayer();
        log('ready');
    }

    if (window.appready) start();
    else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    } else {
        document.addEventListener('app_ready', start);
    }
})();
