(function () {
    'use strict';

    if (window.nfx_skip_plugin) return;
    window.nfx_skip_plugin = true;

    var DB_URL = 'https://raw.githubusercontent.com/ipavlin98/lmp-series-skip-db/refs/heads/main/database/';
    var SKIPDB_API = 'https://api.skipdb.tv/api/segments';
    var INTRODB_API = 'https://api.theintrodb.org/v3/media';
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
            { button: 'Кнопка (Netflix)', auto: 'Одразу, без кнопки', off: 'Вимкнено' },
            'button',
            'Титри / наступна серія',
            'Що робити на фінальних титрах');

        param('nfx_skip_wait',
            { 3: '3 секунди', 4: '4 секунди', 5: '5 секунд', 8: '8 секунд' },
            '4',
            'Заповнення кнопки',
            'Скільки кнопка заповнюється білим до автопропуску');

        param('nfx_skip_tail_tv',
            { off: 'Вимкнено', 60: 'за 1 хв до кінця', 90: 'за 1,5 хв до кінця', 120: 'за 2 хв до кінця', 180: 'за 3 хв до кінця' },
            '90',
            'Серіали без мітки титрів',
            'Якщо в базі немає мітки титрів — рахувати від тривалості серії');

        param('nfx_skip_movie_tail',
            { off: 'Вимкнено', 180: 'за 3 хв до кінця', 300: 'за 5 хв до кінця', 420: 'за 7 хв до кінця', 600: 'за 10 хв до кінця' },
            '300',
            'Титри у фільмах',
            'Для фільмів бази міток немає — позиція титрів рахується від тривалості');

        param('nfx_skip_skipdb',
            { true: 'Увімкнено', false: 'Вимкнено' },
            'true',
            'SkipDB',
            'Відкрита база по IMDb ID: заставка, рекап, титри, прев\'ю. Фільми і серіали');

        param('nfx_skip_introdb',
            { true: 'Увімкнено', false: 'Вимкнено' },
            'true',
            'TheIntroDB',
            'Публічна база міток по TMDB ID — працює без kinopoisk_id, у т.ч. для фільмів');

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

    function tmdbId(card) {
        if (!card) return null;
        if (card.tmdb_id) return card.tmdb_id;
        if (card.source === 'kinopoisk' || card.source === 'kp') return null;
        var id = parseInt(card.id);
        return isNaN(id) ? null : id;
    }

    function imdbId(card) {
        if (!card) return null;
        var id = card.imdb_id || card.imdbId || '';
        return /^tt\d+$/.test(id) ? id : null;
    }

    /**
     * SkipDB працює ТІЛЬКИ по IMDb ID. У картці Lampa його часто немає,
     * тому дотягуємо через TMDB external_ids — ключ і проксі беремо в самої Lampa.
     */
    var imdb_cache = {};

    function resolveImdb(card, serial) {
        var direct = imdbId(card);
        if (direct) return Promise.resolve(direct);

        var tmdb = tmdbId(card);
        if (!tmdb || !Lampa.TMDB || !Lampa.TMDB.api) return Promise.resolve(null);

        var key = (serial ? 'tv' : 'movie') + '/' + tmdb;
        if (imdb_cache[key] !== undefined) return Promise.resolve(imdb_cache[key]);

        var url = Lampa.TMDB.api(key + '/external_ids?api_key=' + Lampa.TMDB.key());

        return fetchJson(url).then(function (data) {
            var id = data && data.imdb_id;
            id = /^tt\d+$/.test(id || '') ? id : null;
            imdb_cache[key] = id;
            log('imdb resolved', tmdb, '->', id);
            return id;
        })['catch'](function () { return null; });
    }

    /**
     * SkipDB — відкрита база (ODbL), intro / recap / outro / preview, фільми і серіали.
     * Головна перевага: приймає duration потоку і зсуває мітки для релізів,
     * що відрізняються на 15 сек (зайве лого на початку) — це саме про торренти.
     * Читання відкрите, 120 запитів/хв.
     */
    function skipdb(imdb, season, episode, duration) {
        if (!imdb) return Promise.resolve([]);

        var q = ['imdb_id=' + encodeURIComponent(imdb)];
        if (season && episode) {
            q.push('season=' + season);
            q.push('episode=' + episode);
        }
        if (duration > 0) q.push('duration=' + Math.round(duration));

        return fetchJson(SKIPDB_API + '?' + q.join('&')).then(function (data) {
            var seg = data && data.segments;
            if (!seg) return [];

            var out = [];

            function add(item, name) {
                if (!item) return;
                // out-of-range означає, що найближчі дані надто відрізняються — не беремо
                if (item.match === 'out-of-range') return;
                var start = (item.start_ms || 0) / 1000;
                var end = item.end_ms === null || item.end_ms === undefined
                    ? (duration > 0 ? duration : start + 600)
                    : item.end_ms / 1000;
                if (end > start) out.push({ start: start, end: end, name: name });
            }

            add(seg.recap, 'Пропустити рекап');
            add(seg.intro, 'Пропустити заставку');
            add(seg.outro, 'Пропустити титри');

            log('skipdb', imdb, out.length + ' сегментів');
            return out;
        });
    }

    /**
     * TheIntroDB — публічна краудсорсна база, ключована TMDB ID (imdb як запасний).
     * Ключ API потрібен лише для відправки міток, читання відкрите.
     * Час віддається в мілісекундах; start_ms: null = з початку, end_ms: null = до кінця.
     */
    function introdb(card, season, episode, duration) {
        var tmdb = tmdbId(card);
        var imdb = imdbId(card);
        if (!tmdb && !imdb) return Promise.resolve([]);

        var q = [];
        if (tmdb) q.push('tmdb_id=' + tmdb);
        else q.push('imdb_id=' + encodeURIComponent(imdb));
        if (season && episode) {
            q.push('season=' + season);
            q.push('episode=' + episode);
        }
        if (duration > 0) q.push('duration_ms=' + Math.round(duration * 1000));

        return fetchJson(INTRODB_API + '?' + q.join('&')).then(function (data) {
            if (!data) return [];
            var out = [];

            function add(list, name, needStart) {
                if (!Array.isArray(list)) return;
                list.forEach(function (seg) {
                    var raw_start = seg.start_ms;
                    var raw_end = seg.end_ms;

                    // титри без початку — сміття, пропускаємо
                    if (needStart && (raw_start === null || raw_start === undefined)) return;

                    var start = (raw_start === null || raw_start === undefined) ? 0 : raw_start / 1000;
                    var end = (raw_end === null || raw_end === undefined)
                        ? (duration > 0 ? duration : start + 600)
                        : raw_end / 1000;

                    if (end > start) out.push({ start: start, end: end, name: name });
                });
            }

            add(data.intro, 'Пропустити заставку', false);
            add(data.recap, 'Пропустити рекап', false);
            add(data.credits, 'Пропустити титри', true);

            log('introdb', tmdb || imdb, out.length + ' сегментів');
            return out;
        });
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

    // Орієнтовна тривалість у секундах з картки TMDB
    function runtimeSec(card, serial) {
        if (!card) return 0;

        if (serial) {
            var ert = card.episode_run_time;
            if (Array.isArray(ert) && ert.length) {
                var e = parseFloat(ert[0]);
                if (!isNaN(e) && e > 0) return e * 60;
            }
            return 0;
        }

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
        var duration = runtimeSec(card, serial);

        var base = {
            intro: null, credits: null, duration: duration, serial: serial,
            derived: false, db: null, season: pos.season, episode: pos.episode
        };

        if (flag('nfx_skip_demo', 'false')) {
            noty('демо-режим, інтро 10-40 сек');
            base.intro = { start: 10, end: 40, name: 'Пропустити заставку' };
            base.duration = 0;
            return Promise.resolve(base);
        }

        if (!card) return Promise.resolve(base);

        var id = kpId(card);
        var chain = Promise.resolve({ list: [], db: null });

        if (id) {
            chain = fetchJson(DB_URL + id + '.json').then(function (db) {
                return { list: fromDb(db, pos.season, serial ? pos.episode : 1) || [], db: db };
            });
        }

        var s_season = serial ? pos.season : 0;
        var s_episode = serial ? pos.episode : 0;

        return chain.then(function (got) {
            base.db = got.db;
            if (got.list.length) return got.list;

            // SkipDB — по IMDb ID, фільми і серіали, з корекцією під реліз
            if (!flag('nfx_skip_skipdb', 'true')) return [];
            return resolveImdb(card, serial).then(function (imdb) {
                return skipdb(imdb, s_season, s_episode, 0);
            });
        }).then(function (list) {
            if (list.length) return list;

            // TheIntroDB — по TMDB ID, kinopoisk_id не потрібен
            if (!flag('nfx_skip_introdb', 'true')) return [];
            return introdb(card, s_season, s_episode, duration);
        }).then(function (list) {
            if (list.length || !serial || !flag('nfx_skip_anime', 'true')) return list;
            if (!isAnime(card)) return list;

            var title = card.original_name || card.original_title || card.name || card.title || '';
            var year = (card.first_air_date || card.release_date || '').slice(0, 4);
            return malId(title.replace(/[:\-]/g, ' ').trim(), pos.season, year).then(function (mal) {
                if (!mal) return [];
                return aniskip(mal, pos.episode);
            });
        }).then(function (list) {
            var split = splitSegments(list, duration);
            base.intro = split.intro;
            base.credits = split.credits;

            // Мітки титрів у базі немає — рахуємо від орієнтовної тривалості.
            // Для вбудованого плеєра це потім уточнюється по фактичній тривалості файлу.
            var tail = serial ? opt('nfx_skip_tail_tv', '90') : opt('nfx_skip_movie_tail', '300');
            if (!base.credits && duration > 0 && tail !== 'off' && tail !== false) {
                var st = duration - parseFloat(tail);
                if (st > 60) {
                    base.credits = { start: st, end: duration, name: 'Пропустити титри' };
                    base.derived = true;
                }
            }

            log('marks', { intro: base.intro, credits: base.credits, duration: base.duration, serial: base.serial, derived: base.derived },
                'kp', id, 'tmdb', tmdbId(card), 'imdb', imdbId(card));
            return base;
        })['catch'](function (e) {
            log('collect error', e);
            return base;
        });
    }

    // Мітки для всіх серій у плейлисті — потрібно зовнішнім плеєрам,
    // які самі гортають плейлист і більше не повертаються у WebView
    function fillPlaylist(data, res) {
        if (!data.playlist || !Array.isArray(data.playlist)) return 0;

        var count = 0;

        data.playlist.forEach(function (item, i) {
            if (hasSegments(item)) return;

            var segments = null;

            if (item.url === data.url) {
                segments = segmentsFor(res);
            } else if (res.db && res.serial) {
                var season = parseInt(item.season || item.s || res.season) || res.season;
                var episode = parseInt(item.episode || item.e || item.episode_number || i + 1);
                var list = fromDb(res.db, season, episode);
                if (list && list.length) {
                    var split = splitSegments(normalize(list), 0);
                    segments = segmentsFor({
                        intro: split.intro,
                        credits: split.credits,
                        duration: 0,
                        derived: false
                    });
                }
            }

            if (segments) {
                item.segments = segments;
                count++;
            }
        });

        return count;
    }

    /* ------------------------------------------------------------------ *
     *  Netflix-кнопка для вбудованого веб-плеєра
     * ------------------------------------------------------------------ */

    function initStyle() {
        var css = document.createElement('style');
        css.textContent = [
            '.nfx-skip{position:absolute;right:2.5em;bottom:2.5em;z-index:200;',
            'display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;',
            '-webkit-transition:bottom .3s;transition:bottom .3s}',

            '.nfx-btn{position:relative;display:-webkit-box;display:flex;',
            '-webkit-box-align:center;align-items:center;-webkit-box-pack:center;justify-content:center;',
            'height:2.6em;padding:0 1.6em;margin-left:.7em;overflow:hidden;cursor:pointer;',
            '-webkit-border-radius:2em;border-radius:2em;',
            'background:rgba(255,255,255,.35);color:#141414;',
            'font-size:1.3em;font-weight:700;white-space:nowrap}',

            '.nfx-btn--ghost{background:rgba(255,255,255,.22);color:#fff;font-weight:600}',

            '.nfx-btn__fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:#fff;',
            '-webkit-transform:scaleX(0);transform:scaleX(0);',
            '-webkit-transform-origin:left center;transform-origin:left center}',
            '.nfx-btn__fill--run{-webkit-transform:scaleX(1);transform:scaleX(1)}',

            '.nfx-btn__in{position:relative;z-index:2;display:-webkit-box;display:flex;',
            '-webkit-box-align:center;align-items:center}',
            '.nfx-btn__icon{width:1em;height:1em;margin-right:.55em;fill:currentColor}',

            '.nfx-btn.focus{background:rgba(255,255,255,.6);',
            'box-shadow:0 0 0 .13em #fff}',
            '.nfx-btn--ghost.focus{background:#fff;color:#141414}',

            '.player--panel-visible .nfx-skip{bottom:12em}'
        ].join('');
        document.head.appendChild(css);
    }

    var $wrap = null;
    var $main = null;
    var btn_timer = null;
    var btn_action = null;

    var ICON = '<svg class="nfx-btn__icon" viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>';

    function hideButton() {
        if (btn_timer) { clearTimeout(btn_timer); btn_timer = null; }
        btn_action = null;
        if ($wrap) { $wrap.remove(); $wrap = null; $main = null; }
        try {
            if (Lampa.Controller.enabled() && Lampa.Controller.enabled().name === 'nfx_skip') {
                Lampa.Controller.toggle('player');
            }
        } catch (e) {}
    }

    function addController() {
        Lampa.Controller.add('nfx_skip', {
            toggle: function () {
                if (!$wrap) return Lampa.Controller.toggle('player');
                Lampa.Controller.collectionSet($wrap);
                Lampa.Controller.collectionFocus($main ? $main[0] : false, $wrap);
            },
            left: function () { Lampa.Controller.move('left'); },
            right: function () { Lampa.Controller.move('right'); },
            up: function () {
                if (Lampa.PlayerPanel.visibleStatus()) Lampa.PlayerPanel.hide();
                else Lampa.PlayerPanel.reveal();
            },
            down: function () { Lampa.PlayerPanel.toggle(); },
            gone: function () { if ($wrap) $wrap.find('.nfx-btn').removeClass('focus'); },
            back: function () { hideButton(); }
        });
    }

    /**
     * @param {object} o { title, icon, cancel, wait, action, oncancel }
     */
    function showButton(o) {
        if ($wrap) return;

        btn_action = o.action;

        $wrap = $('<div class="nfx-skip"></div>');

        if (o.cancel) {
            var $ghost = $('<div class="nfx-btn nfx-btn--ghost selector">' +
                '<div class="nfx-btn__in">' + o.cancel + '</div></div>');
            $ghost.on('hover:enter click', function () {
                var stop = o.oncancel;
                hideButton();
                if (stop) stop();
            });
            $wrap.append($ghost);
        }

        $main = $('<div class="nfx-btn nfx-btn--main selector">' +
            '<div class="nfx-btn__fill"></div>' +
            '<div class="nfx-btn__in">' + (o.icon ? ICON : '') + o.title + '</div></div>');

        $main.on('hover:enter click', function () {
            var run = btn_action;
            hideButton();
            if (run) run();
        });

        $wrap.append($main);
        $(Lampa.Player.render()).append($wrap);

        var wait = o.wait;
        var $fill = $main.find('.nfx-btn__fill');

        if (wait > 0) {
            $fill.css({
                '-webkit-transition': '-webkit-transform ' + wait + 's linear',
                transition: 'transform ' + wait + 's linear'
            });
            // reflow, інакше браузер склеїть встановлення класу і transition в один кадр
            $fill[0].offsetWidth;
            $fill.addClass('nfx-btn__fill--run');

            btn_timer = setTimeout(function () {
                var run = btn_action;
                hideButton();
                if (run) run();
            }, wait * 1000);
        }

        try {
            var now = Lampa.Controller.enabled();
            if (now && (now.name === 'player' || now.name === 'player_panel')) {
                Lampa.Controller.toggle('nfx_skip');
            }
        } catch (e) {}
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

    var done = { intro: false, credits: false, tail: false };

    function canNext() {
        try { return !!(marks.serial && Lampa.PlayerPlaylist.canNext && Lampa.PlayerPlaylist.canNext()); }
        catch (e) { return false; }
    }

    // Мітка титрів з фактичної тривалості файлу, якщо в базі її немає
    function deriveCredits(duration) {
        if (done.tail || marks.credits || !duration) return;
        done.tail = true;

        var tail = marks.serial ? opt('nfx_skip_tail_tv', '90') : opt('nfx_skip_movie_tail', '300');
        if (tail === 'off' || tail === false) return;

        var start = duration - parseFloat(tail);
        if (start > 60) {
            marks.credits = { start: start, end: duration, name: '' };
            marks.duration = duration;
            log('credits derived from duration', marks.credits);
        }
    }

    function watch(e) {
        if (!marks.ready) return;
        if (opt('nfx_skip_button_style', 'nfx') !== 'nfx') return;

        var time = e.current || 0;
        var duration = e.duration || 0;
        if (!time) return;

        var wait = num('nfx_skip_wait', '4');
        var intro_mode = opt('nfx_skip_intro_mode', 'button');
        var credits_mode = opt('nfx_skip_credits_mode', 'button');

        /* --- заставка --- */
        if (marks.intro && !done.intro && intro_mode !== 'off') {
            if (time >= marks.intro.start && time < marks.intro.end - 1) {
                if (intro_mode === 'auto') {
                    done.intro = true;
                    seekTo(marks.intro.end);
                    noty('заставку пропущено');
                } else if (!$wrap) {
                    showButton({
                        title: 'Пропустити заставку',
                        cancel: 'Дивитися',
                        wait: wait,
                        action: function () {
                            done.intro = true;
                            seekTo(marks.intro.end);
                        },
                        oncancel: function () { done.intro = true; }
                    });
                }
            } else if (time >= marks.intro.end) {
                done.intro = true;
                if (btn_action) hideButton();
            }
        }

        /* --- титри --- */
        if (credits_mode === 'off') return;

        // фільм: мітка порахована з runtime картки, а реальний файл може бути іншої тривалості
        if (marks.credits && duration > 0 && marks.duration > 0 && Math.abs(duration - marks.duration) > 10) {
            var shift = duration - marks.duration;
            marks.credits = {
                start: Math.max(60, marks.credits.start + shift),
                end: duration,
                name: marks.credits.name
            };
            marks.duration = duration;
        }

        deriveCredits(duration);

        if (marks.credits && !done.credits && time >= marks.credits.start) {
            var next = canNext();

            if (credits_mode === 'auto') {
                done.credits = true;
                hideButton();
                finish();
                return;
            }

            if (!$wrap) {
                showButton({
                    title: next ? 'Наступний епізод' : 'Завершити перегляд',
                    icon: next,
                    cancel: 'Дивитися титри',
                    wait: wait,
                    action: function () {
                        done.credits = true;
                        finish();
                    },
                    oncancel: function () { done.credits = true; }
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
        // duration_ms — тільки для власноруч порахованих міток: Lampa підганяє їх
        // під фактичну тривалість файлу. Для міток з бази це зіпсувало б час.
        if (res.derived && res.duration > 0) out.duration_ms = res.duration * 1000;
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
        done = { intro: false, credits: false, tail: false };

        var external = isExternal(data);
        var native_ui = external || opt('nfx_skip_button_style', 'nfx') !== 'nfx';

        var where = external ? 'зовнішній плеєр' : 'вбудований плеєр';

        if (!native_ui) {
            if (res.intro || res.credits) noty(label(res) + ' — мітки готові (' + where + ')');
            else noty(label(res) + ' — міток немає');
            return;
        }

        // Зовнішній плеєр (tvOS Pro, Infuse, VLC) отримує мітки прямо в посиланні запуску:
        // lampa://video?player=tvospro&src=...&playlist=...&segments=...
        var segments = segmentsFor(res);
        if (segments && !hasSegments(data)) data.segments = segments;

        var filled = fillPlaylist(data, res);

        marks.ready = false;

        if (segments || filled) {
            noty(label(res) + ' — мітки передано в ' + where +
                (filled ? ', серій у плейлисті: ' + filled : ''));
        } else {
            noty(label(res) + ' — міток немає в жодній базі');
        }

        log('launch segments', data.segments, 'playlist filled', filled,
            'lampa', (Lampa.Manifest && Lampa.Manifest.app_version) || '?');
    }

    function label(res) {
        return res.serial ? 'S' + res.season + 'E' + res.episode : 'фільм';
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

    // Зовнішні плеєри отримують мітки через параметр &segments= у lampa://video.
    // Він з'явився в Lampa 3.3.0 — на старіших збірках плагін нічого туди не передасть.
    function checkVersion() {
        try {
            var v = (Lampa.Manifest && Lampa.Manifest.app_version) || '';
            var digital = parseInt(String(v).replace(/\./g, '')) || 0;
            log('lampa version', v);
            if (digital && digital < 330) {
                noty('Lampa ' + v + ' — зовнішні плеєри не отримають мітки, потрібна 3.3.0+');
            }
        } catch (e) {}
    }

    function start() {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo) return;
        initStyle();
        initSettings();
        addController();
        initPlayer();
        checkVersion();
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
