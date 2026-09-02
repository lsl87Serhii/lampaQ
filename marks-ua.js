(function () {
    'use strict';

    if (typeof Lampa === 'undefined') return;
    if (window.marks_ua_plugin) return;
    window.marks_ua_plugin = true;

    /* ------------------------------------------------------------------ *
     *  КОНФІГ
     * ------------------------------------------------------------------ */

    var LOG = false;                               // true — детальні логи в консоль
    var CACHE_KEY = 'marks_ua_cache_v1';
    var CACHE_TIME = 12 * 60 * 60 * 1000;          // 12 годин — успішна відповідь
    var CACHE_FAIL_TIME = 10 * 60 * 1000;          // 10 хвилин — таймаут/помилка
    var CACHE_LIMIT = 600;                         // максимум записів у кеші
    var MAX_PARALLEL = 1;                          // балансери не люблять паралельних запитів
    var REQUEST_GAP = 250;                         // пауза між запитами, мс
    var YEAR_TOLERANCE = 1;                        // допуск розбіжності року

    var RES_ORDER = ['SD', 'HD', 'FHD', '2K', '4K'];

    // Українські трекери. Порівняння за входженням у назву трекера.
    var UA_TRACKERS = [
        'toloka', 'mazepa', 'hurtom', 'uafilm', 'ukrbit',
        'kinoukr', 'ex.ua', 'ua-tracker', 'ukrainian'
    ];

    var memCache = {};
    var pending = {};
    var queue = [];
    var active = 0;
    var unknownTrackers = {};

    function log() {
        if (LOG) console.log.apply(console, ['[MARKS-UA]'].concat([].slice.call(arguments)));
    }

    /* ------------------------------------------------------------------ *
     *  НАЛАШТУВАННЯ LAMPA
     * ------------------------------------------------------------------ */

    function sfield(name, def) {
        var v;
        try {
            if (Lampa.Storage.field) v = Lampa.Storage.field(name);
        } catch (e) { }
        if (v === undefined || v === null || v === '') v = Lampa.Storage.get(name, def);
        return (v === undefined || v === null || v === '') ? def : v;
    }

    function isSettingEnabled(key, defaultVal) {
        var val = Lampa.Storage.get(key, defaultVal);
        if (val === undefined || val === null || val === '') return !!defaultVal;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
            var t = val.trim().toLowerCase();
            if (t === 'false' || t === '0' || t === 'off' || t === 'no') return false;
            if (t === 'true' || t === '1' || t === 'on' || t === 'yes') return true;
        }
        return !!val;
    }

    // Так само, як Lampa.Utils.checkEmptyUrl
    function checkEmptyUrl(url) {
        url = String(url || '').trim();
        if (!url) return '';
        if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return url;
        return (window.location.protocol === 'https:' ? 'https://' : 'http://') + url;
    }

    // Повторює логіку Lampa: parserLinks() + selectParserLinks()
    // 'one' — основна, 'two' — додаткова, інше — обидві
    function getParserLinks() {
        // Власна адреса з налаштувань плагіна має пріоритет над парсером Lampa
        var ownUrl = String(Lampa.Storage.get('marks_parser_url', '') || '').trim();
        if (ownUrl) {
            return [{
                url: checkEmptyUrl(ownUrl),
                key: String(Lampa.Storage.get('marks_parser_key', '') || '').trim()
            }];
        }

        var links = [
            { url: sfield('jackett_url', ''), key: sfield('jackett_key', '') },
            { url: sfield('jackett_url_two', ''), key: sfield('jackett_key_two', '') }
        ];

        var use = sfield('parser_use_link', 'one');
        var picked;

        if (use === 'one') picked = links[0] && links[0].url ? [links[0]] : [];
        else if (use === 'two') picked = links[1] && links[1].url ? [links[1]] : [];
        else picked = links.filter(function (l) { return l && l.url; });

        return picked.map(function (l) {
            return { url: checkEmptyUrl(String(l.url).replace('jacred.xyz', 'jac.red')), key: String(l.key || '') };
        });
    }

    function parserTimeout() {
        var t = parseInt(sfield('parse_timeout', 15), 10);
        if (!t || t < 3) t = 15;
        return t * 1000;
    }

    /* ------------------------------------------------------------------ *
     *  КЕШ
     * ------------------------------------------------------------------ */

    function readStore() {
        var c = Lampa.Storage.get(CACHE_KEY, {});
        return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {};
    }

    function getCache(key) {
        if (memCache[key]) return memCache[key];
        var item = readStore()[key];
        if (item && item._ts && (Date.now() - item._ts < (item._ttl || CACHE_TIME))) {
            memCache[key] = item;
            return item;
        }
        return null;
    }

    function setCache(key, data, ttl) {
        data._ts = Date.now();
        data._ttl = ttl || CACHE_TIME;
        memCache[key] = data;
        try {
            var store = readStore();
            store[key] = data;

            var keys = Object.keys(store);
            if (keys.length > CACHE_LIMIT) {
                keys.sort(function (a, b) { return (store[a]._ts || 0) - (store[b]._ts || 0); });
                for (var i = 0; i < keys.length - CACHE_LIMIT; i++) delete store[keys[i]];
            }

            Lampa.Storage.set(CACHE_KEY, store);
        } catch (e) { }
    }

    function clearCache() {
        memCache = {};
        try { Lampa.Storage.set(CACHE_KEY, {}); } catch (e) { }
    }

    /* ------------------------------------------------------------------ *
     *  ЗАПИТ ДО ПАРСЕРА (Jackett / Spawn)
     * ------------------------------------------------------------------ */

    // mode 'full'  — як робить сама Lampa: title + title_original + year + is_serial
    // mode 'plain' — лише Query, коли сервер на повний набір нічого не віддав
    function buildUrl(link, movie, query, mode) {
        var interview = sfield('jackett_interview', 'all') === 'healthy' ? 'status:healthy' : 'all';

        var url = link.url + '/api/v2.0/indexers/' + interview + '/results' +
            '?apikey=' + encodeURIComponent(link.key) +
            '&Query=' + encodeURIComponent(query);

        if (mode !== 'full') return url;

        var title = String(movie.title || movie.name || '');
        var orig = String(movie.original_title || movie.original_name || '');
        var isSerial = (movie.original_name || movie.first_air_date || movie.number_of_seasons) ? '2' : '1';

        // &year НЕ надсилаємо: рік у TMDB часто на рік відрізняється від року
        // в назві роздачі, і сервер відсікає потрібне ще до нас.
        // Рік звіряємо самі, з допуском ±1.
        if (title) url += '&title=' + encodeURIComponent(title);
        if (orig) url += '&title_original=' + encodeURIComponent(orig);
        url += '&is_serial=' + isSerial;

        return url;
    }

    function requestParser(link, movie, query, mode, callback) {
        var url = buildUrl(link, movie, query, mode);
        log('запит', url);

        try {
            var req = new Lampa.Reguest();
            req.timeout(parserTimeout());
            req.silent(url, function (json) {
                callback(null, json);
            }, function (err) {
                log('помилка', url, err);
                callback(err || new Error('request failed'));
            });
        } catch (e) {
            callback(e);
        }
    }

    function parseResults(res) {
        if (!res) return [];
        if (typeof res === 'string') {
            try { res = JSON.parse(res); } catch (e) { return []; }
        }
        if (Array.isArray(res)) return res;
        if (res.Results && Array.isArray(res.Results)) return res.Results;
        if (res.results && Array.isArray(res.results)) return res.results;
        return [];
    }

    /* ------------------------------------------------------------------ *
     *  ФІЛЬТР УКРАЇНСЬКИХ ТРЕКЕРІВ
     * ------------------------------------------------------------------ */

    function trackerName(item) {
        return String(
            (item && (item.Tracker || item.tracker || item.TrackerName ||
                      item.trackerName || item.indexer || item.Indexer)) || ''
        ).toLowerCase();
    }

    function isUaTracker(item) {
        var name = trackerName(item);
        if (!name) return false;
        for (var i = 0; i < UA_TRACKERS.length; i++) {
            if (name.indexOf(UA_TRACKERS[i]) >= 0) return true;
        }
        if (LOG && !unknownTrackers[name]) {
            unknownTrackers[name] = true;
            log('невідомий трекер (відкинуто):', name);
        }
        return false;
    }

    /* ------------------------------------------------------------------ *
     *  РІК
     * ------------------------------------------------------------------ */

    function movieYear(movie) {
        if (!movie) return 0;
        var fields = [movie.release_date, movie.first_air_date, movie.year, movie.date, movie.release_year];
        for (var i = 0; i < fields.length; i++) {
            if (!fields[i]) continue;
            var m = String(fields[i]).match(/(19\d{2}|20\d{2})/);
            if (m) {
                var y = parseInt(m[1], 10);
                if (y >= 1900 && y <= 2100) return y;
            }
        }
        return 0;
    }

    // Роки з назви роздачі. Числа роздільної (1080, 2160, 1440) не рахуються за рік.
    function torrentYears(title) {
        var years = [];
        var re = /(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/g;
        var t = String(title || '');
        var m;
        while ((m = re.exec(t)) !== null) {
            var y = parseInt(m[1], 10);
            if (y >= 1900 && y <= 2100 && years.indexOf(y) === -1) years.push(y);
            re.lastIndex = m.index + 1;
        }
        return years;
    }

    function yearMatches(title, wantYear) {
        if (!wantYear) return true;
        var years = torrentYears(title);
        if (!years.length) return null;         // року в назві немає — вирішимо пізніше
        for (var i = 0; i < years.length; i++) {
            if (Math.abs(years[i] - wantYear) <= YEAR_TOLERANCE) return true;
        }
        return false;
    }

    /* ------------------------------------------------------------------ *
     *  НОМЕР ЧАСТИНИ (щоб «Ваяна» не отримала якість від «Ваяна 2»)
     * ------------------------------------------------------------------ */

    var ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };

    // Беремо тільки «шапку» назви — до року або до технічних деталей.
    // Завдяки цьому "DTS 5.1" чи "AAC 2.0" більше не вважаються номером частини.
    function titleHead(title) {
        var t = String(title || '');
        var cut = t.search(/\(?(?:19|20)\d{2}\)?/);
        if (cut > 0) t = t.substr(0, cut);
        return t;
    }

    function partNumber(name) {
        var n = String(name || '').toLowerCase()
            .replace(/[\[\]\(\)\.,:;!?]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        var m = n.match(/(?:^|\s)(\d{1,2}|i{1,3}|iv|vi{0,3})$/);
        if (!m) return 0;
        var v = m[1];
        if (/^\d+$/.test(v)) {
            var num = parseInt(v, 10);
            return (num >= 2 && num <= 20) ? num : 0;
        }
        return ROMAN[v] || 0;
    }

    function moviePartNumber(movie) {
        return partNumber(movie.title || movie.name || '') ||
               partNumber(movie.original_title || movie.original_name || '');
    }

    function torrentPartNumber(title) {
        var head = titleHead(title);
        var parts = head.split('/');
        var max = 0;
        for (var i = 0; i < parts.length; i++) {
            var n = partNumber(parts[i]);
            if (n > max) max = n;
        }
        return max;
    }

    /* ------------------------------------------------------------------ *
     *  РОЗДІЛЬНА, HDR, МОВА
     * ------------------------------------------------------------------ */

    // Ніяких припущень: якщо роздільну не вказано — повертаємо '' і бейджа не буде.
    function detectResolution(item) {
        var t = String((item && (item.Title || item.title || item.name)) || '').toLowerCase();

        if (/(^|[^0-9a-z])(2160[pi]?|4k|uhd|ultra\s?hd)([^0-9a-z]|$)/.test(t)) return '4K';
        if (/(^|[^0-9a-z])(1440[pi]?|2k|qhd)([^0-9a-z]|$)/.test(t)) return '2K';
        if (/(^|[^0-9a-z])(1080[pi]?|fhd|full\s?hd)([^0-9a-z]|$)/.test(t)) return 'FHD';
        if (/(^|[^0-9a-z])(720[pi]?|hdrip|hdtv)([^0-9a-z]|$)/.test(t)) return 'HD';
        if (/(^|[^0-9a-z])(480[pi]?|576[pi]?|dvdrip|dvdscr|vhsrip|sdrip)([^0-9a-z]|$)/.test(t)) return 'SD';

        // деякі поля можуть містити роздільну окремо
        var q = parseInt(String((item && (item.quality || item.Quality || item.resolution)) || ''), 10) || 0;
        if (q >= 2160) return '4K';
        if (q >= 1440) return '2K';
        if (q >= 1080) return 'FHD';
        if (q >= 720) return 'HD';

        return '';
    }

    // Широкий запит повертає музику, софт і 3D-моделі з тією ж назвою.
    // ВАЖЛИВО: flac/lossless трапляються в аудіодоріжках 4K-ремуксів,
    // тому сміттям вважаємо лише те, де НЕМАЄ жодної відеоознаки.
    function hasVideoMarkers(title) {
        var t = String(title || '').toLowerCase();
        return /(2160|1440|1080|720|480|576|\buhd\b|\b4k\b|web-?dl|web-?rip|bd-?rip|bd-?remux|blu-?ray|hdtv|hdrip|dvdrip|\bavc\b|\bhevc\b|x26[45]|h\.?26[45]|remux)/.test(t);
    }

    function isJunkRelease(title) {
        if (hasVideoMarkers(title)) return false;
        var t = String(title || '').toLowerCase();
        return /(flac|lossless|\bmp3\b|kbps|\bogg\b|discography|soundtrack|\bost\b|\[ep\]|vsti|\bvst\b|\baax\b|\.stl\b|3d print)/.test(t);
    }

    function isCamRelease(title) {
        var t = String(title || '').toLowerCase();
        return /(^|[^a-z])(camrip|telesync|telecine|hdcam|hdts|ts|tc|cam|screener|scr)([^a-z]|$)/.test(t);
    }

    function detectHdr(title, item) {
        var t = String(title || '').toLowerCase();
        var videoType = String((item && (item.videotype || item.VideoType)) || '').toLowerCase();

        if (t.indexOf('dolby vision') >= 0 || t.indexOf('dolbyvision') >= 0 ||
            /(^|[^a-z])dovi([^a-z]|$)/.test(t) || /(^|[^a-z])dv([^a-z]|$)/.test(t)) {
            return { hdr: true, dv: true };
        }
        if (videoType === 'hdr' || /(^|[^a-z])hdr(10)?(\+)?([^a-z]|$)/.test(t)) {
            return { hdr: true, dv: false };
        }
        return { hdr: false, dv: false };
    }

    function hasEnglish(title) {
        var t = String(title || '').toLowerCase();
        return /(^|[^a-z])(eng|english|multi|dual)([^a-z]|$)/.test(t);
    }

    /* ------------------------------------------------------------------ *
     *  АНАЛІЗ РЕЗУЛЬТАТІВ
     * ------------------------------------------------------------------ */

    function emptyData() {
        return { empty: true, resolution: '', ukr: false, eng: false, hdr: false, dolbyVision: false };
    }

    function analyze(items, movie) {
        var wantYear = movieYear(movie);
        var wantPart = moviePartNumber(movie);
        var uaOnly = isSettingEnabled('marks_ua_only', true);

        var strict = [];     // рік у назві збігається
        var undated = [];    // року в назві немає

        items.forEach(function (item) {
            if (!item) return;

            var title = String(item.Title || item.title || item.name || '');
            if (!title) return;

            if (uaOnly && !isUaTracker(item)) return;
            if (isJunkRelease(title)) return;
            if (isCamRelease(title)) return;
            if (torrentPartNumber(title) !== wantPart) return;

            var ym = yearMatches(title, wantYear);
            if (ym === true) strict.push(item);
            else if (ym === null) undated.push(item);
        });

        // Роздачі без року беремо лише тоді, коли з роком не знайшлось нічого:
        // сервер уже фільтрував за &year= і &title_original=
        var chosen = strict.length ? strict : undated;
        if (!chosen.length) return emptyData();

        var best = emptyData();
        var bestIdx = -1;
        var found = false;

        chosen.forEach(function (item) {
            var title = String(item.Title || item.title || item.name || '');
            found = true;

            if (hasEnglish(title)) best.eng = true;

            var res = detectResolution(item);
            if (!res) return;

            var idx = RES_ORDER.indexOf(res);
            if (idx > bestIdx) {
                bestIdx = idx;
                best.resolution = res;
                var h = detectHdr(title, item);
                best.hdr = h.hdr;
                best.dolbyVision = h.dv;
            } else if (idx === bestIdx) {
                // та сама роздільна — не втрачаємо HDR/DV з іншої роздачі
                var h2 = detectHdr(title, item);
                if (h2.hdr) best.hdr = true;
                if (h2.dv) best.dolbyVision = true;
            }
        });

        if (!found) return emptyData();

        best.ukr = true;    // джерело — українські трекери
        best.empty = false;
        return best;
    }

    /* ------------------------------------------------------------------ *
     *  ПОШУК
     * ------------------------------------------------------------------ */

    // callback(data, failed) — failed=true, якщо жоден запит не дійшов до сервера
    function searchMovie(movie, callback) {
        var links = getParserLinks();
        if (!links.length) {
            log('парсер не налаштовано');
            return callback(emptyData(), false);
        }

        var orig = String(movie.original_title || movie.original_name || '').trim();
        var loc = String(movie.title || movie.name || '').trim();

        var queries = [];
        if (orig) queries.push(orig);
        if (loc && loc !== orig) queries.push(loc);
        if (!queries.length) return callback(emptyData(), false);

        // Повний запит (як у Lampa) — основний і найшвидший для балансера.
        // Спрощені варіанти пробуємо ЛИШЕ якщо сервер відповів, але порожньо.
        // Після помилки/таймауту не довантажуємо сервер повторами.
        var tasks = [];
        for (var l = 0; l < links.length; l++) {
            tasks.push({ link: links[l], query: queries[0], mode: 'full' });
            tasks.push({ link: links[l], query: queries[0], mode: 'plain' });
            if (queries[1]) tasks.push({ link: links[l], query: queries[1], mode: 'plain' });
        }

        var anyResponse = false;

        function step(i) {
            if (i >= tasks.length) return callback(emptyData(), !anyResponse);

            requestParser(tasks[i].link, movie, tasks[i].query, tasks[i].mode, function (err, json) {
                if (err) {
                    // сервер не відповів — далі не мучимо його цим фільмом
                    log('немає відповіді:', tasks[i].query, tasks[i].mode);
                    return callback(emptyData(), !anyResponse);
                }

                anyResponse = true;

                var items = parseResults(json);
                log('роздач:', items.length, '| запит:', tasks[i].query, '| режим:', tasks[i].mode);

                if (items.length) {
                    var data = analyze(items, movie);
                    if (!data.empty) return callback(data, false);
                }

                step(i + 1);
            });
        }

        step(0);
    }

    /* ------------------------------------------------------------------ *
     *  ДІАГНОСТИКА
     *  У консолі: MARKS_UA_TEST('Обсесія')
     * ------------------------------------------------------------------ */

    function debugSearch(query, year) {
        var links = getParserLinks();
        if (!links.length) return console.log('[MARKS-UA] парсер не налаштовано');

        var fake = { id: 0, title: query, original_title: query, release_date: (year || '') + '' };
        var url = buildUrl(links[0], fake, query, 'full');
        console.log('[MARKS-UA] джерело:', links[0].url, '| ключ:', links[0].key);
        console.log('[MARKS-UA] запит:', url);

        var req = new Lampa.Reguest();
        req.timeout(parserTimeout());
        req.silent(url, function (json) {
            var items = parseResults(json);
            console.log('[MARKS-UA] отримано роздач:', items.length);

            var trackers = {};
            items.forEach(function (item) {
                var title = String(item.Title || item.title || '');
                var tr = trackerName(item) || '(без трекера)';
                trackers[tr] = (trackers[tr] || 0) + 1;

                console.log(
                    (isUaTracker(item) ? 'UA ' : '-- ') +
                    (detectResolution(item) || '???').padEnd(4) + ' | ' +
                    'роки: ' + JSON.stringify(torrentYears(title)) + ' | ' +
                    'частина: ' + torrentPartNumber(title) + ' | ' +
                    tr + ' | ' + title
                );
            });

            console.log('[MARKS-UA] трекери у відповіді:', trackers);
        }, function (e) {
            console.log('[MARKS-UA] помилка запиту:', e);
        });
    }

    /* ------------------------------------------------------------------ *
     *  ЧЕРГА
     * ------------------------------------------------------------------ */

    function pump() {
        while (active < MAX_PARALLEL && queue.length) runTask(queue.shift());
    }

    function runTask(task) {
        active++;
        searchMovie(task.movie, function (data, failed) {
            // невдалий запит кешуємо лише на 10 хвилин, щоб картка не лишалась
            // без бейджів на пів доби через один таймаут сервера
            setCache(task.key, data, failed ? CACHE_FAIL_TIME : CACHE_TIME);

            var cbs = pending[task.key] || [];
            delete pending[task.key];
            for (var i = 0; i < cbs.length; i++) {
                try { cbs[i](data); } catch (e) { }
            }

            active--;
            setTimeout(pump, REQUEST_GAP);
        });
    }

    function resolveMarks(movie, callback) {
        var id = movie.id || movie.imdb_id || movie.kp_id;
        if (!id) return callback(emptyData());

        var type = movie.media_type || movie.type || ((movie.name || movie.original_name) ? 'tv' : 'movie');
        var key = type + '_' + id;

        var cached = getCache(key);
        if (cached) return callback(cached);

        if (pending[key]) return pending[key].push(callback);

        pending[key] = [callback];
        queue.push({ key: key, movie: movie });
        pump();
    }

    /* ------------------------------------------------------------------ *
     *  МАЛЮВАННЯ БЕЙДЖІВ
     * ------------------------------------------------------------------ */

    function getMovieFromCard(cardNode) {
        if (!cardNode) return null;
        var $card = $(cardNode);
        return cardNode.heroMovieData ||
               cardNode.card_data ||
               cardNode.item ||
               $card.data('item') ||
               $card.data('card_data') ||
               null;
    }

    function createBadge(cssClass, label) {
        var badge = document.createElement('div');
        badge.className = 'marks-ua-badge marks-ua-badge--' + cssClass;
        badge.textContent = label;
        return badge;
    }

    function extractRating(movie) {
        var candidates = [movie.imdb_rating, movie.kp_rating, movie.vote_average, movie.rating];
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i] === undefined || candidates[i] === null || candidates[i] === '') continue;
            var n = parseFloat(String(candidates[i]).replace(',', '.'));
            if (!isNaN(n) && n > 0) return n;
        }
        return 0;
    }

    function renderBadges(container, data, movie) {
        container.empty();
        if (!isSettingEnabled('marks_enabled', true)) return;

        data = data || emptyData();

        // Мітки з парсера
        if (!data.empty) {
            if (data.ukr && isSettingEnabled('marks_ua', true)) container.append(createBadge('ua', 'UA'));
            if (data.eng && isSettingEnabled('marks_en', true)) container.append(createBadge('en', 'EN'));

            if (data.resolution && isSettingEnabled('marks_quality', true)) {
                if (data.resolution === '4K') container.append(createBadge('4k', '4K'));
                else if (data.resolution === '2K') container.append(createBadge('fhd', '2K'));
                else if (data.resolution === 'FHD') container.append(createBadge('fhd', '1080p'));
                else if (data.resolution === 'HD') container.append(createBadge('hd', '720p'));
                else if (data.resolution === 'SD') container.append(createBadge('sd', 'SD'));
            }

            if (data.hdr && isSettingEnabled('marks_hdr', true)) {
                container.append(createBadge('hdr', data.dolbyVision ? 'DV' : 'HDR'));
            }
        }

        // Рейтинг і рік показуємо завжди — вони не залежать від парсера
        if (isSettingEnabled('marks_rating', true)) {
            var rating = extractRating(movie);
            if (rating > 0) {
                var rBadge = document.createElement('div');
                rBadge.className = 'marks-ua-badge marks-ua-badge--rating';
                rBadge.innerHTML = '<span class="marks-ua-star">&#9733;</span>' + rating.toFixed(1);
                container.append(rBadge);
            }
        }

        if (isSettingEnabled('marks_year', true)) {
            var year = movieYear(movie);
            if (year) container.append(createBadge('year', String(year)));
        }
    }

    function processCards(scope) {
        if (!isSettingEnabled('marks_enabled', true)) return;

        var cards;
        if (scope && scope.length) {
            var nodes = [];
            for (var i = 0; i < scope.length; i++) {
                var node = scope[i];
                if (!node || node.nodeType !== 1) continue;
                if (node.matches && node.matches('.card')) nodes.push(node);
                var nested = node.querySelectorAll ? node.querySelectorAll('.card') : [];
                for (var j = 0; j < nested.length; j++) nodes.push(nested[j]);
            }
            cards = $(nodes).not('.marks-ua-processed');
        } else {
            cards = $('.card').not('.marks-ua-processed');
        }

        cards.each(function () {
            var $card = $(this);
            var movie = getMovieFromCard(this);
            if (!movie || !movie.id || movie.size) return;

            $card.addClass('marks-ua-processed');

            var parent = $card.hasClass('hero-banner') ? $card : ($card.find('.card__view').first().length ? $card.find('.card__view').first() : $card);
            if (parent.css('position') === 'static') parent.css('position', 'relative');

            var container = parent.find('.marks-ua-container').first();
            if (!container.length) {
                container = $('<div class="marks-ua-container"></div>');
                parent.append(container);
            }

            // рейтинг і рік — миттєво, решта — після відповіді парсера
            renderBadges(container, emptyData(), movie);

            resolveMarks(movie, function (data) {
                if (!document.body.contains($card[0])) return;
                renderBadges(container, data, movie);
            });
        });
    }

    function refreshAll() {
        $('.marks-ua-container').remove();
        $('.card').removeClass('marks-ua-processed');
        document.body.classList.toggle('marks-ua-on', isSettingEnabled('marks_enabled', true));
        processCards();
    }

    /* ------------------------------------------------------------------ *
     *  СТИЛІ
     * ------------------------------------------------------------------ */

    function injectStyle() {
        if (document.getElementById('marks-ua-style')) return;

        var style = document.createElement('style');
        style.id = 'marks-ua-style';
        style.innerHTML = '\
            body.marks-ua-on .card__vote,\
            body.marks-ua-on .card__quality,\
            body.marks-ua-on .card__type { display: none !important; }\
            .marks-ua-container {\
                position: absolute;\
                top: 0.5em;\
                left: 0.4em;\
                display: flex;\
                flex-direction: column;\
                gap: 0.2em;\
                z-index: 20;\
                pointer-events: none;\
            }\
            .marks-ua-badge {\
                padding: 0.3em 0.45em;\
                font-size: 0.75em;\
                font-weight: 800;\
                line-height: 1;\
                border-radius: 0.3em;\
                display: inline-flex;\
                align-items: center;\
                justify-content: center;\
                align-self: flex-start;\
                border: 1px solid rgba(255,255,255,0.2);\
                box-shadow: 0 2px 5px rgba(0,0,0,0.5);\
                color: #fff;\
                white-space: nowrap;\
            }\
            .marks-ua-badge--ua     { background: linear-gradient(135deg, #1565c0, #42a5f5); }\
            .marks-ua-badge--en     { background: linear-gradient(135deg, #37474f, #78909c); }\
            .marks-ua-badge--4k     { background: linear-gradient(135deg, #e65100, #ff9800); }\
            .marks-ua-badge--fhd    { background: linear-gradient(135deg, #4a148c, #ab47bc); }\
            .marks-ua-badge--hd     { background: linear-gradient(135deg, #1b5e20, #66bb6a); }\
            .marks-ua-badge--sd     { background: linear-gradient(135deg, #424242, #757575); }\
            .marks-ua-badge--hdr    { background: linear-gradient(135deg, #f57f17, #ffeb3b); color: #000; }\
            .marks-ua-badge--rating { background: linear-gradient(135deg, #1a1a2e, #16213e); color: #ffd700; }\
            .marks-ua-badge--year   { background: linear-gradient(135deg, #212121, #4e4e4e); }\
            .marks-ua-star { margin-right: 0.15em; }\
        ';

        (document.head || document.documentElement).appendChild(style);
    }

    /* ------------------------------------------------------------------ *
     *  НАЛАШТУВАННЯ
     * ------------------------------------------------------------------ */

    function setupSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;
        if (window.marks_ua_settings) return;
        window.marks_ua_settings = true;

        var component = 'interface';
        var refresh = function () { setTimeout(refreshAll, 50); };

        function trigger(name, label, def, onchange) {
            Lampa.SettingsApi.addParam({
                component: component,
                param: { name: name, type: 'trigger', default: def },
                field: { name: label },
                onChange: onchange || refresh
            });
        }

        Lampa.SettingsApi.addParam({
            component: component,
            param: { type: 'title' },
            field: { name: 'Мітки якості (UA)' }
        });

        trigger('marks_enabled', 'Увімкнути модуль міток', true);
        trigger('marks_ua', 'Показувати мітку UA', true);
        trigger('marks_en', 'Показувати мітку EN', true);
        trigger('marks_quality', 'Показувати якість (4K / 1080p / 720p)', true);
        trigger('marks_hdr', 'Показувати HDR / Dolby Vision', true);
        trigger('marks_rating', 'Показувати рейтинг', true);
        trigger('marks_year', 'Показувати рік', true);

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_ua_only', type: 'trigger', default: true },
            field: {
                name: 'Тільки українські трекери',
                description: 'Якість рахується лише за роздачами з toloka, mazepa, hurtom тощо'
            },
            onChange: function () { clearCache(); refresh(); }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: {
                name: 'marks_parser_url',
                type: 'input',
                values: '',
                placeholder: 'spawnum.duckdns.org:59117',
                default: ''
            },
            field: {
                name: 'Своя адреса парсера',
                description: 'Порожньо — брати парсер із налаштувань Lampa'
            },
            onChange: function () { clearCache(); refresh(); }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: {
                name: 'marks_parser_key',
                type: 'input',
                values: '',
                placeholder: '2',
                default: ''
            },
            field: {
                name: 'API ключ свого парсера',
                description: 'Потрібен разом зі своєю адресою'
            },
            onChange: function () { clearCache(); refresh(); }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_cache_clear', type: 'button' },
            field: { name: 'Очистити кеш міток', description: 'Скинути збережені дані про якість' },
            onChange: function () {
                clearCache();
                if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Кеш міток очищено');
                refresh();
            }
        });
    }

    /* ------------------------------------------------------------------ *
     *  СТАРТ
     * ------------------------------------------------------------------ */

    function runInit() {
        setupSettings();
        injectStyle();

        window.MARKS_UA_TEST = debugSearch;
        window.MARKS_UA_CLEAR = clearCache;

        document.body.classList.toggle('marks-ua-on', isSettingEnabled('marks_enabled', true));

        var timer = null;
        var roots = [];

        function schedule(mutations) {
            if (mutations) {
                for (var i = 0; i < mutations.length; i++) {
                    var added = mutations[i].addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        if (added[j] && added[j].nodeType === 1) roots.push(added[j]);
                    }
                }
            }
            if (timer) return;
            timer = setTimeout(function () {
                timer = null;
                var batch = roots.slice(0);
                roots = [];
                processCards(batch.length ? batch : null);
            }, 120);
        }

        var observer = new MutationObserver(schedule);
        var target = document.getElementById('app') || document.body;
        if (target) observer.observe(target, { childList: true, subtree: true });

        processCards();
        setTimeout(processCards, 500);
        setTimeout(processCards, 2000);
        setInterval(function () { processCards(); }, 5000);   // страховка, не щосекунди
    }

    if (window.appready) runInit();
    else if (Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') runInit(); });
    } else setTimeout(runInit, 1000);
})();
