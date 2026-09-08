(function () {
    'use strict';

    if (window.nfx_skip_plugin) return;
    window.nfx_skip_plugin = true;

    var SKIPDB_API = 'https://api.skipdb.tv/api/segments';
    var INTRODB_API = 'https://api.theintrodb.org/v3/media';
    var KPDB_URL = 'https://raw.githubusercontent.com/ipavlin98/lmp-series-skip-db/refs/heads/main/database/';
    var ANISKIP_API = 'https://api.aniskip.com/v2/skip-times';
    var ANILIST_API = 'https://graphql.anilist.co';
    var JIKAN_API = 'https://api.jikan.moe/v4/anime';

    /* ================================================================== *
     *  1. Налаштування
     * ================================================================== */

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
            { button: 'Кнопка з автонатисканням', auto: 'Одразу, без кнопки', off: 'Вимкнено' },
            'button',
            'Пропуск заставки',
            'Що робити на початку заставки');

        param('nfx_skip_credits_mode',
            { button: 'Кнопка з автонатисканням', auto: 'Одразу, без кнопки', off: 'Вимкнено' },
            'button',
            'Титри та наступна серія',
            'Що робити на фінальних титрах');

        param('nfx_skip_wait',
            { 2: '2 секунди', 3: '3 секунди', 5: '5 секунд', 8: '8 секунд', 0: 'Не натискати само' },
            '3',
            'Автонатискання',
            'За скільки кнопка заповнюється білим і спрацьовує сама');

        param('nfx_skip_offset',
            { 0: 'Без запасу', 1: '1 секунда', 2: '2 секунди', 3: '3 секунди', 5: '5 секунд' },
            '2',
            'Запас при пропуску',
            'Перемотує на стільки раніше кінця заставки, щоб не зрізати початок серії');

        param('nfx_skip_tail_tv',
            { off: 'Вимкнено', 60: 'за 1 хв до кінця', 90: 'за 1,5 хв до кінця', 120: 'за 2 хв до кінця', 180: 'за 3 хв до кінця' },
            '90',
            'Серіали без мітки титрів',
            'Якщо мітки титрів немає в базах — рахувати від тривалості серії');

        param('nfx_skip_movie_tail',
            { off: 'Вимкнено', 180: 'за 3 хв до кінця', 300: 'за 5 хв до кінця', 420: 'за 7 хв до кінця', 600: 'за 10 хв до кінця' },
            '300',
            'Фільми без мітки титрів',
            'Те саме для фільмів');

        param('nfx_skip_skipdb',
            { true: 'Увімкнено', false: 'Вимкнено' },
            'true',
            'База SkipDB',
            'По IMDb ID, фільми і серіали, з корекцією під конкретний реліз');

        param('nfx_skip_introdb',
            { true: 'Увімкнено', false: 'Вимкнено' },
            'true',
            'База TheIntroDB',
            'По TMDB ID, працює без kinopoisk_id');

        param('nfx_skip_anime',
            { true: 'Увімкнено', false: 'Вимкнено' },
            'true',
            'База AniSkip',
            'Опенінги та ендінги для аніме');

        param('nfx_skip_probe',
            { false: 'Вимкнено', true: 'Увімкнено' },
            'false',
            'Тест кнопки поверх плеєра',
            'Малює кнопку по секундоміру від старту — щоб перевірити, чи видно HTML поверх tvOS Pro');

        param('nfx_skip_demo',
            { false: 'Вимкнено', true: 'Увімкнено' },
            'false',
            'Демо-режим',
            'Підставляє заставку 10-40 сек на будь-якому відео');

        param('nfx_skip_noty',
            { true: 'Показувати', false: 'Не показувати' },
            'true',
            'Повідомлення',
            'Сповіщення про знайдені мітки та джерело');
    }

    /* ================================================================== *
     *  2. Мітки: нормалізація і класифікація
     * ================================================================== */

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

    function isCredits(seg, duration) {
        var name = (seg.name || '').toLowerCase();
        if (name.indexOf('титр') !== -1 || name.indexOf('credit') !== -1 ||
            name.indexOf('ендінг') !== -1 || name.indexOf('эндинг') !== -1 ||
            name.indexOf('ending') !== -1) return true;
        if (duration > 0) return seg.start >= duration * 0.7 || seg.end >= duration - 15;
        return false;
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

    function hasSegments(obj) {
        return !!(obj && obj.segments && obj.segments.skip && obj.segments.skip.length);
    }

    /**
     * Мітки в базах зроблені по іншому релізу, тому кінець заставки часто
     * пізніший за фактичний і пропуск зрізає перші кадри серії.
     * Віднімаємо запас: краще додивитись хвіст заставки, ніж втратити сюжет.
     */
    function introEnd(seg) {
        if (!seg) return 0;
        var offset = num('nfx_skip_offset', '2');
        var end = seg.end - offset;
        return end > seg.start ? end : seg.end;
    }

    /* ================================================================== *
     *  3. Ідентифікатори
     * ================================================================== */

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

    function fetchJson(url, options) {
        return fetch(url, options).then(function (res) {
            if (!res.ok) return null;
            return res.json();
        })['catch'](function () { return null; });
    }

    // SkipDB працює тільки по IMDb ID. У картці Lampa його часто немає,
    // тому дотягуємо через TMDB external_ids — ключ і проксі беремо в самої Lampa.
    var imdb_cache = {};

    function resolveImdb(card, serial) {
        var direct = imdbId(card);
        if (direct) return Promise.resolve(direct);

        var tmdb = tmdbId(card);
        if (!tmdb || !Lampa.TMDB || !Lampa.TMDB.api) return Promise.resolve(null);

        var key = (serial ? 'tv' : 'movie') + '/' + tmdb;
        if (imdb_cache[key] !== undefined) return Promise.resolve(imdb_cache[key]);

        return fetchJson(Lampa.TMDB.api(key + '/external_ids?api_key=' + Lampa.TMDB.key())).then(function (data) {
            var id = data && data.imdb_id;
            id = /^tt\d+$/.test(id || '') ? id : null;
            imdb_cache[key] = id;
            log('imdb', tmdb, '->', id);
            return id;
        })['catch'](function () { return null; });
    }

    /* ================================================================== *
     *  4. Джерела міток
     * ================================================================== */

    function kpdb(id, season, episode) {
        if (!id) return Promise.resolve({ list: [], db: null });

        return fetchJson(KPDB_URL + id + '.json').then(function (db) {
            if (!db) return { list: [], db: null };
            var s = String(season);
            var e = String(episode);
            var list = (db[s] && db[s][e]) || db.movie || [];
            return { list: list, db: db };
        });
    }

    /**
     * SkipDB — відкрита база (ODbL): intro / recap / outro / preview.
     * duration у секундах вмикає зсув міток під реліз, що відрізняється до 15 сек.
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
                // найближчі дані надто відрізняються від нашого потоку — не беремо
                if (item.match === 'out-of-range') return;
                var start = (item.start_ms || 0) / 1000;
                var end = (item.end_ms === null || item.end_ms === undefined)
                    ? (duration > 0 ? duration : start + 600)
                    : item.end_ms / 1000;
                if (end > start) out.push({ start: start, end: end, name: name });
            }

            add(seg.recap, 'Пропустити рекап');
            add(seg.intro, 'Пропустити заставку');
            add(seg.outro, 'Пропустити титри');

            log('skipdb', imdb, out.length);
            return out;
        });
    }

    /**
     * TheIntroDB — краудсорсна база по TMDB ID (imdb як запасний).
     * start_ms: null = з початку, end_ms: null = до кінця файлу.
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
                    var rs = seg.start_ms;
                    var re = seg.end_ms;
                    if (needStart && (rs === null || rs === undefined)) return;

                    var start = (rs === null || rs === undefined) ? 0 : rs / 1000;
                    var end = (re === null || re === undefined)
                        ? (duration > 0 ? duration : start + 600)
                        : re / 1000;

                    if (end > start) out.push({ start: start, end: end, name: name });
                });
            }

            add(data.intro, 'Пропустити заставку', false);
            add(data.recap, 'Пропустити рекап', false);
            add(data.credits, 'Пропустити титри', true);

            log('introdb', tmdb || imdb, out.length);
            return out;
        });
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

    /* ================================================================== *
     *  5. Розбір даних плеєра
     * ================================================================== */

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

    // Орієнтовна тривалість з картки TMDB
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
        return (!isNaN(r) && r > 0) ? r * 60 : 0;
    }

    // Фактична тривалість файлу, якщо Lampa зберегла її з попереднього перегляду
    function knownDuration(data) {
        var d = (data.timeline && data.timeline.duration) || data.duration || 0;
        d = parseFloat(d);
        return (!isNaN(d) && d > 60) ? d : 0;
    }

    // Куди піде відео: у вбудований веб-плеєр Lampa чи в зовнішній (tvOS Pro, Infuse, VLC)
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

    /* ================================================================== *
     *  6. Збір міток
     * ================================================================== */

    function collect(data) {
        var card = getCard(data);
        var pos = getPosition(data);
        var serial = isSerial(card, data);
        var exact = knownDuration(data);
        var duration = exact || runtimeSec(card, serial);

        var base = {
            intro: null, credits: null,
            duration: duration, serial: serial, derived: false,
            db: null, season: pos.season, episode: pos.episode,
            source: ''
        };

        if (flag('nfx_skip_demo', 'false')) {
            base.intro = { start: 10, end: 40, name: 'Пропустити заставку' };
            base.duration = 0;
            base.source = 'демо';
            return Promise.resolve(base);
        }

        if (!card) return Promise.resolve(base);

        var s_season = serial ? pos.season : 0;
        var s_episode = serial ? pos.episode : 0;

        return kpdb(kpId(card), pos.season, serial ? pos.episode : 1).then(function (got) {
            base.db = got.db;
            if (got.list.length) {
                base.source = 'KP-база';
                return got.list;
            }

            if (!flag('nfx_skip_skipdb', 'true')) return [];

            return resolveImdb(card, serial).then(function (imdb) {
                return skipdb(imdb, s_season, s_episode, exact);
            }).then(function (list) {
                if (list.length) base.source = 'SkipDB';
                return list;
            });
        }).then(function (list) {
            if (list.length) return list;
            if (!flag('nfx_skip_introdb', 'true')) return [];

            return introdb(card, s_season, s_episode, exact).then(function (res) {
                if (res.length) base.source = 'TheIntroDB';
                return res;
            });
        }).then(function (list) {
            if (list.length || !serial || !flag('nfx_skip_anime', 'true')) return list;
            if (!isAnime(card)) return list;

            var title = card.original_name || card.original_title || card.name || card.title || '';
            var year = (card.first_air_date || card.release_date || '').slice(0, 4);

            return malId(title.replace(/[:\-]/g, ' ').trim(), pos.season, year).then(function (mal) {
                if (!mal) return [];
                return aniskip(mal, pos.episode).then(function (res) {
                    if (res.length) base.source = 'AniSkip';
                    return res;
                });
            });
        }).then(function (list) {
            var split = splitSegments(list, duration);
            base.intro = split.intro;
            base.credits = split.credits;

            // Титрів немає в жодній базі — рахуємо від тривалості
            var tail = serial ? opt('nfx_skip_tail_tv', '90') : opt('nfx_skip_movie_tail', '300');
            if (!base.credits && duration > 0 && tail !== 'off' && tail !== false) {
                var st = duration - parseFloat(tail);
                if (st > 60) {
                    base.credits = { start: st, end: duration, name: 'Пропустити титри' };
                    base.derived = true;
                    if (!base.source) base.source = 'розрахунок';
                }
            }

            log('marks', {
                intro: base.intro, credits: base.credits,
                source: base.source, serial: serial, duration: duration
            }, 'kp', kpId(card), 'tmdb', tmdbId(card), 'imdb', imdbId(card));

            return base;
        })['catch'](function (e) {
            log('collect error', e);
            return base;
        });
    }

    /* ================================================================== *
     *  7. Передача міток зовнішньому плеєру
     * ================================================================== */

    function segmentsFor(res) {
        var skip = [];
        if (res.intro) skip.push({ start: res.intro.start, end: introEnd(res.intro), name: res.intro.name });
        if (res.credits) skip.push({ start: res.credits.start, end: res.credits.end, name: res.credits.name });
        if (!skip.length) return null;

        var out = { skip: skip };
        // duration_ms тільки для власноруч порахованих міток: Lampa підганяє їх
        // під фактичну тривалість. Для міток з бази це зіпсувало б час.
        if (res.derived && res.duration > 0) out.duration_ms = res.duration * 1000;
        return out;
    }

    // Зовнішній плеєр отримує весь плейлист одразу і гортає серії сам,
    // у WebView більше не повертається — тому мітки треба на кожну серію
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
                var list = (res.db[String(season)] && res.db[String(season)][String(episode)]) || null;

                if (list && list.length) {
                    var split = splitSegments(list, 0);
                    segments = segmentsFor({
                        intro: split.intro, credits: split.credits,
                        duration: 0, derived: false
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

    /* ================================================================== *
     *  8. Кнопка в стилі Netflix
     * ================================================================== */

    function initStyle() {
        var css = document.createElement('style');
        css.textContent = [
            '.nfx-skip{position:fixed;right:3em;bottom:3em;z-index:9999999;',
            'display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;',
            'pointer-events:auto;-webkit-transition:bottom .3s;transition:bottom .3s}',

            '.nfx-btn{position:relative;display:-webkit-box;display:flex;',
            '-webkit-box-align:center;align-items:center;-webkit-box-pack:center;justify-content:center;',
            'height:2.6em;padding:0 1.6em;margin-left:.7em;overflow:hidden;cursor:pointer;',
            '-webkit-border-radius:2em;border-radius:2em;',
            'background:rgba(255,255,255,.35);color:#141414;',
            'font-size:1.3em;font-weight:700;font-family:inherit;white-space:nowrap}',

            '.nfx-btn--ghost{background:rgba(255,255,255,.22);color:#fff;font-weight:600}',

            '.nfx-btn__fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:#fff;',
            '-webkit-transform:scaleX(0);transform:scaleX(0);',
            '-webkit-transform-origin:left center;transform-origin:left center}',
            '.nfx-btn__fill--run{-webkit-transform:scaleX(1);transform:scaleX(1)}',

            '.nfx-btn__in{position:relative;z-index:2;display:-webkit-box;display:flex;',
            '-webkit-box-align:center;align-items:center}',
            '.nfx-btn__icon{width:1em;height:1em;margin-right:.55em;fill:currentColor}',

            '.nfx-btn.focus{background:rgba(255,255,255,.6);box-shadow:0 0 0 .13em #fff}',
            '.nfx-btn--ghost.focus{background:#fff;color:#141414}',

            '.player--panel-visible .nfx-skip{bottom:12em}'
        ].join('');
        document.head.appendChild(css);
    }

    var ICON = '<svg class="nfx-btn__icon" viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>';

    var $wrap = null;
    var $main = null;
    var btn_timer = null;
    var btn_action = null;

    function buttonVisible() {
        return !!$wrap;
    }

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
                try {
                    if (Lampa.PlayerPanel.visibleStatus()) Lampa.PlayerPanel.hide();
                    else Lampa.PlayerPanel.reveal();
                } catch (e) {}
            },
            down: function () {
                try { Lampa.PlayerPanel.toggle(); } catch (e) {}
            },
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
            var $ghost = $('<div class="nfx-btn nfx-btn--ghost selector"><div class="nfx-btn__in">' + o.cancel + '</div></div>');
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

        // position:fixed + максимальний z-index у body, а не в контейнері плеєра,
        // щоб кнопка не залежала від того, який шар зараз зверху
        $('body').append($wrap);

        var wait = o.wait;

        if (wait > 0) {
            var $fill = $main.find('.nfx-btn__fill');
            $fill.css({
                '-webkit-transition': '-webkit-transform ' + wait + 's linear',
                transition: 'transform ' + wait + 's linear'
            });
            // reflow, інакше браузер склеїть клас і transition в один кадр
            if ($fill[0]) $fill[0].offsetWidth;
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

    /* ================================================================== *
     *  9. Дії
     * ================================================================== */

    // Перемотка існує тільки для вбудованого <video>: Lampa.PlayerVideo.to()
    // виставляє video.currentTime. Зовнішній плеєр з JS не перемотати —
    // там пропуск робить сам додаток по переданих segments.
    function canSeek() {
        try { return !!(Lampa.PlayerVideo && Lampa.PlayerVideo.video && Lampa.PlayerVideo.video()); }
        catch (e) { return false; }
    }

    function seekTo(sec) {
        if (!canSeek()) {
            noty('кнопка видима, але перемотати зовнішній плеєр з JS неможливо');
            return false;
        }

        try {
            var video = Lampa.PlayerVideo.video();
            var dur = video ? video.duration || 0 : 0;
            Lampa.PlayerVideo.to(dur ? Math.min(sec, dur - 1) : sec);
            return true;
        } catch (e) {
            log('seek error', e);
            return false;
        }
    }

    function canNext() {
        try { return !!(marks && marks.serial && Lampa.PlayerPlaylist.canNext && Lampa.PlayerPlaylist.canNext()); }
        catch (e) { return false; }
    }

    function finish() {
        try {
            if (canNext()) Lampa.PlayerPlaylist.next();
            else Lampa.Player.close();
        } catch (e) {
            try { Lampa.Player.close(); } catch (e2) {}
        }
    }

    /* ================================================================== *
     *  10. Стан і годинник відтворення
     * ================================================================== */

    var marks = null;
    var done = null;
    var clock = null;

    function resetState() {
        hideButton();
        if (clock && clock.timer) clearInterval(clock.timer);

        marks = { intro: null, credits: null, duration: 0, serial: false, ready: false };
        done = { intro: false, credits: false, tail: false };
        clock = { t0: 0, video: false, timer: null };
    }

    // Секундомір від моменту запуску. Єдиний доступний відлік, коли відео
    // грає в зовнішньому плеєрі і подій timeupdate немає.
    function startClock() {
        clock.t0 = Date.now();
        clock.video = false;

        if (clock.timer) clearInterval(clock.timer);
        clock.timer = setInterval(function () {
            if (clock.video) return;
            if (!flag('nfx_skip_probe', 'false')) return;
            try {
                watch({ current: (Date.now() - clock.t0) / 1000, duration: 0 });
            } catch (e) {
                log('probe error', e);
            }
        }, 500);
    }

    /* ================================================================== *
     *  11. Логіка показу
     * ================================================================== */

    function deriveCredits(duration) {
        if (done.tail || marks.credits || !duration) return;
        done.tail = true;

        var tail = marks.serial ? opt('nfx_skip_tail_tv', '90') : opt('nfx_skip_movie_tail', '300');
        if (tail === 'off' || tail === false) return;

        var start = duration - parseFloat(tail);
        if (start > 60) {
            marks.credits = { start: start, end: duration, name: 'Пропустити титри' };
            marks.duration = duration;
        }
    }

    function watch(e) {
        if (!marks || !marks.ready) return;

        var time = e.current || 0;
        var duration = e.duration || 0;
        if (!time) return;

        var wait = num('nfx_skip_wait', '3');
        var intro_mode = opt('nfx_skip_intro_mode', 'button');
        var credits_mode = opt('nfx_skip_credits_mode', 'button');

        /* --- заставка --- */
        if (marks.intro && !done.intro && intro_mode !== 'off') {
            if (time >= marks.intro.start && time < marks.intro.end - 1) {
                if (intro_mode === 'auto') {
                    done.intro = true;
                    if (seekTo(introEnd(marks.intro))) noty('заставку пропущено');
                } else if (!buttonVisible()) {
                    showButton({
                        title: marks.intro.name || 'Пропустити заставку',
                        cancel: 'Дивитися',
                        wait: wait,
                        action: function () {
                            done.intro = true;
                            seekTo(introEnd(marks.intro));
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

        // мітка порахована з тривалості картки, а файл може бути іншої довжини
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
            if (credits_mode === 'auto') {
                done.credits = true;
                hideButton();
                finish();
                return;
            }

            if (!buttonVisible()) {
                var next = canNext();
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

    /* ================================================================== *
     *  12. Підміна Lampa.Player.play
     * ================================================================== */

    function label(res) {
        return res.serial ? 'S' + res.season + 'E' + res.episode : 'фільм';
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
        var found = !!(res.intro || res.credits);

        if (!external) {
            noty(label(res) + (found ? ' — мітки з ' + res.source : ' — міток немає'));
            return;
        }

        // Зовнішній плеєр отримує мітки прямо в посиланні запуску:
        // lampa://video?player=tvospro&src=...&playlist=...&segments=...
        var segments = segmentsFor(res);
        if (segments && !hasSegments(data)) data.segments = segments;

        var filled = fillPlaylist(data, res);

        // Без timeupdate власна кнопка може працювати лише по секундоміру,
        // тому поза режимом тесту вона тут не показується.
        if (!flag('nfx_skip_probe', 'false')) marks.ready = false;

        if (segments || filled) {
            noty(label(res) + ' — мітки з ' + res.source + ' передано плеєру' +
                (filled ? ', серій: ' + filled : ''));
        } else {
            noty(label(res) + ' — міток немає в жодній базі');
        }

        log('launch', data.segments, 'playlist', filled,
            'lampa', (Lampa.Manifest && Lampa.Manifest.app_version) || '?');
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

            function run() {
                original_play.call(ctx, data);
                if (pending) {
                    try { Lampa.PlayerPlaylist.set(pending); } catch (e) {}
                    pending = null;
                }
                startClock();
            }

            resetState();

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
            if (clock) clock.video = true;
            try { watch(e); } catch (err) { log('watch error', err); }
        });

        Lampa.Player.listener.follow('destroy', function () {
            resetState();
        });
    }

    /* ================================================================== *
     *  13. Старт
     * ================================================================== */

    // Параметр &segments= у lampa://video з'явився в Lampa 3.3.0
    function checkVersion() {
        try {
            var v = (Lampa.Manifest && Lampa.Manifest.app_version) || '';
            var digital = parseInt(String(v).replace(/\./g, '')) || 0;
            log('lampa', v);
            if (digital && digital < 330) {
                noty('Lampa ' + v + ' — зовнішні плеєри не отримають мітки, потрібна 3.3.0+');
            }
        } catch (e) {}
    }

    function start() {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo) return;

        resetState();
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
