(function () {
    'use strict';

    if (window.marks_quality_merged_v1) return;
    window.marks_quality_merged_v1 = true;

    if (typeof Lampa === 'undefined') {
        console.warn('Marks+Quality: Lampa not found');
        return;
    }

    /* ------------------------------------------------------------------ *
     *  CONFIG
     * ------------------------------------------------------------------ */

    var LOG = false;                                   // true = логи в консоль
    var DEFAULT_JACRED = 'jr.maxvol.pro';              // публічний JacRed (як у qlty.js)
    var CACHE_KEY = 'marks_quality_cache_v1';
    var CACHE_TIME = 24 * 60 * 60 * 1000;              // 24 години
    var CACHE_LIMIT = 800;                             // максимум записів у кеші
    var REQ_TIMEOUT = 6000;                            // таймаут одного запиту / проксі
    var MAX_PARALLEL = 3;                              // паралельних запитів до JacRed
    var RES_ORDER = ['SD', 'HD', 'FHD', '2K', '4K'];

    // Якість рахується ВИКЛЮЧНО за релізами з цих трекерів
    var UA_TRACKERS = ['toloka', 'mazepa'];

    var memCache = {};
    var pending = {};
    var queue = [];
    var active = 0;

    function log() {
        if (LOG) console.log.apply(console, ['MARKS+Q'].concat([].slice.call(arguments)));
    }

    /* ------------------------------------------------------------------ *
     *  SETTINGS HELPERS
     * ------------------------------------------------------------------ */

    function normalizeSettingBoolean(val, defaultVal) {
        if (val === undefined || val === null || val === '') return !!defaultVal;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val !== 0;
        if (typeof val === 'string') {
            var t = val.trim().toLowerCase();
            if (!t) return !!defaultVal;
            if (t === 'false' || t === '0' || t === 'off' || t === 'no' || t === 'none' || t === 'null' || t === 'disabled') return false;
            if (t === 'true' || t === '1' || t === 'on' || t === 'yes' || t === 'enabled') return true;
        }
        return !!val;
    }

    function isSettingEnabled(key, defaultVal) {
        return normalizeSettingBoolean(Lampa.Storage.get(key, defaultVal), defaultVal);
    }

    function normalizeHost(raw) {
        raw = String(raw || '').trim();
        if (!raw) return '';
        var proto = /^https:\/\//i.test(raw) ? 'https://' : 'http://';
        raw = raw.replace(/^https?:\/\//i, '')
                 .replace(/\/api\/.*$/i, '')
                 .replace(/\/+$/, '');
        return raw ? (proto + raw) : '';
    }

    // Адреса, яку LAMPA вже використовує для торент-парсера
    // (те, що вибрано у списку джерел: LampaUA / SpawnUA / Jac.red тощо)
    function detectParserHost() {
        var keys = ['jackett_url', 'jacred_url', 'parser_torrent_url', 'jackett_urltwo'];
        for (var i = 0; i < keys.length; i++) {
            var v = Lampa.Storage.get(keys[i], '');
            if (v && typeof v === 'string' && v.trim()) {
                var host = normalizeHost(v);
                if (host) return host;
            }
        }
        return '';
    }

    // Повертає список хостів у порядку спроб: обраний -> резервний
    function jacredHosts() {
        var setting = String(Lampa.Storage.get('marks_jacred_url', 'auto') || 'auto').trim();
        var list = [];

        if (!setting || setting.toLowerCase() === 'auto') {
            var detected = detectParserHost();
            if (detected) list.push(detected);
        } else {
            var manual = normalizeHost(setting);
            if (manual) list.push(manual);
        }

        if (isSettingEnabled('marks_jacred_fallback', true)) {
            var fb = normalizeHost(DEFAULT_JACRED);
            if (list.indexOf(fb) === -1) list.push(fb);
        }

        if (!list.length) list.push(normalizeHost(DEFAULT_JACRED));
        return list;
    }

    /* ------------------------------------------------------------------ *
     *  CACHE
     * ------------------------------------------------------------------ */

    function readStore() {
        var c = Lampa.Storage.get(CACHE_KEY, {});
        return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {};
    }

    function getCache(key) {
        if (memCache[key]) return memCache[key];
        var item = readStore()[key];
        if (item && item._ts && (Date.now() - item._ts < CACHE_TIME)) {
            memCache[key] = item;
            return item;
        }
        return null;
    }

    function setCache(key, data) {
        data._ts = Date.now();
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
     *  NETWORK (direct -> proxies, як у qlty.js)
     * ------------------------------------------------------------------ */

    function fetchText(url, callback) {
        var builders = [
            function (u) { return u; },
            function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
            function (u) { return 'http://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
            function (u) { return 'https://cors.bwa.workers.dev/' + encodeURIComponent(u); },
            function (u) { return 'http://cors.bwa.workers.dev/' + encodeURIComponent(u); }
        ];
        var index = 0;
        var done = false;

        function next() {
            if (done) return;
            if (index >= builders.length) {
                done = true;
                return callback(new Error('all transports failed'));
            }
            var reqUrl = builders[index++](url);
            var xhr = new XMLHttpRequest();
            try { xhr.open('GET', reqUrl, true); } catch (e) { return next(); }
            xhr.timeout = REQ_TIMEOUT;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
                    done = true;
                    callback(null, xhr.responseText);
                } else next();
            };
            xhr.onerror = function () { next(); };
            xhr.ontimeout = function () { next(); };
            try { xhr.send(); } catch (e2) { next(); }
        }

        next();
    }

    /* ------------------------------------------------------------------ *
     *  DATA MODEL
     * ------------------------------------------------------------------ */

    function emptyMarksData() {
        return { empty: true, resolution: 'SD', ukr: false, eng: false, hdr: false, dolbyVision: false };
    }

    function getCardType(card) {
        var type = card.media_type || card.type;
        if (type === 'movie' || type === 'tv') return type;
        return (card.name || card.original_name) ? 'tv' : 'movie';
    }

    function parseTorrents(body) {
        var parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { return []; }
        if (parsed && parsed.contents) {
            try { parsed = JSON.parse(parsed.contents); } catch (e2) { }
        }
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.Results)) return parsed.Results;
        return [];
    }

    // Реліз вважається українським лише якщо він з українського трекера.
    // Друга лінія захисту: навіть якщо сервер проігнорує параметр tracker,
    // сюди нічого російського не пройде.
    function isUaRelease(item) {
        var fields = [
            item && item.trackerName,
            item && item.tracker,
            item && item.Tracker,
            item && item.url,
            item && item.Details
        ];
        for (var i = 0; i < fields.length; i++) {
            var v = String(fields[i] || '').toLowerCase();
            if (!v) continue;
            for (var j = 0; j < UA_TRACKERS.length; j++) {
                if (v.indexOf(UA_TRACKERS[j]) >= 0) return true;
            }
        }
        return false;
    }

    // Роздільна визначається лише за явними ознаками.
    // Немає ознаки — повертаємо '' (мітки не буде), а не вигадану 1080p.
    function detectResolution(item) {
        var t = String(item && item.title || '').toLowerCase();

        // 1. явний токен у назві релізу — найнадійніше
        if (/(^|[^0-9a-z])(2160[pi]?|4k|uhd)([^0-9a-z]|$)/.test(t)) return '4K';
        if (/(^|[^0-9a-z])(1440[pi]?|2k)([^0-9a-z]|$)/.test(t)) return '2K';
        if (/(^|[^0-9a-z])(1080[pi]?|fhd|full ?hd)([^0-9a-z]|$)/.test(t)) return 'FHD';
        if (/(^|[^0-9a-z])(720[pi]?|hdrip|hdtv)([^0-9a-z]|$)/.test(t)) return 'HD';
        if (/(^|[^0-9a-z])(480[pi]?|360[pi]?|sd|dvdrip|vhsrip|dvdscr)([^0-9a-z]|$)/.test(t)) return 'SD';

        // 2. числове поле quality від JacRed
        var q = parseInt(item && item.quality, 10) || 0;
        if (q >= 2160) return '4K';
        if (q >= 1440) return '2K';
        if (q >= 1080) return 'FHD';
        if (q >= 720) return 'HD';
        if (q > 0) return 'SD';

        return '';
    }

    // Рік самої роздачі — щоб не приписати картці якість від однойменного фільму іншого року
    function releaseYear(item) {
        var direct = parseInt(item && (item.relased || item.released || item.year), 10);
        if (direct >= 1900) return direct;
        var m = String(item && item.title || '').match(/(^|[^0-9])(19|20)(\d{2})([^0-9]|$)/);
        if (m) return parseInt(m[2] + m[3], 10);
        return 0;
    }

    // wantYear: якщо передано — беруться лише роздачі того ж року (±1)
    function analyzeTorrents(results, movie, wantYear) {
        var best = emptyMarksData();
        var bestRes = '';
        var found = false;

        results.forEach(function (item) {
            if (!isUaRelease(item)) return;

            if (wantYear) {
                var ry = releaseYear(item);
                if (!ry || Math.abs(ry - wantYear) > 1) return;
            }

            var t = String(item && item.title || '').toLowerCase();

            // екранки не рахуємо взагалі
            if (/(^|[^a-z])(ts|telesync|camrip|cam|tc|telecine|screener)([^a-z]|$)/.test(t)) return;

            found = true;

            if (/(^|[^a-z])(eng|english|multi)([^a-z]|$)/.test(t)) best.eng = true;

            var res = detectResolution(item);
            if (!res) return;

            if (RES_ORDER.indexOf(res) > RES_ORDER.indexOf(bestRes)) {
                bestRes = res;

                var isDv = t.indexOf('dolby vision') >= 0 || t.indexOf('dolbyvision') >= 0 || /(^|[^a-z])dovi([^a-z]|$)/.test(t);
                var videoType = String(item && item.videotype || '').toLowerCase();
                best.dolbyVision = isDv;
                best.hdr = isDv || videoType === 'hdr' || /(^|[^a-z])hdr(10)?(\+)?([^a-z]|$)/.test(t);
            }
        });

        if (!found) return emptyMarksData();

        best.resolution = bestRes || 'SD';
        best.ukr = true;   // джерело — виключно українські трекери
        best.empty = false;
        return best;
    }

    /* ------------------------------------------------------------------ *
     *  JACRED
     * ------------------------------------------------------------------ */

    // Деякі збірки JacRed не розуміють параметр &tracker=.
    // Дізнаємось це один раз на хост і більше його не шлемо.
    var trackerParamBroken = {};

    function buildJacredUrl(host, title, year, uid, useTracker) {
        return host + '/api/v1.0/torrents?search=' + encodeURIComponent(title) +
            (year ? '&year=' + year : '') +
            '&exact=true&uid=' + encodeURIComponent(uid) +
            (useTracker ? '&tracker=' + encodeURIComponent(UA_TRACKERS.join(',')) : '');
    }

    function jacredSearch(movie, callback) {
        var dateRaw = movie.release_date || movie.first_air_date || '';
        var year = String(dateRaw).substr(0, 4);
        if (!year || isNaN(year)) return callback(emptyMarksData());

        var uid = Lampa.Storage.get('lampac_unic_id', '');
        var titles = [];
        var orig = (movie.original_title || movie.original_name || '').trim();
        var loc = (movie.title || movie.name || '').trim();
        if (orig && /[a-zа-яёіїєґ0-9]/i.test(orig)) titles.push(orig);
        if (loc && loc !== orig && /[a-zа-яёіїєґ0-9]/i.test(loc)) titles.push(loc);
        if (!titles.length) return callback(emptyMarksData());

        var hosts = jacredHosts();
        var tasks = [];
        for (var h = 0; h < hosts.length; h++) {
            for (var t = 0; t < titles.length; t++) {
                // спершу точний пошук з роком, потім без нього
                // (рік на трекері часто не збігається з датою TMDB)
                tasks.push({ host: hosts[h], title: titles[t], useYear: true });
                tasks.push({ host: hosts[h], title: titles[t], useYear: false });
            }
        }

        function runTask(task, done) {
            var host = task.host;
            var useTracker = !trackerParamBroken[host];
            var url = buildJacredUrl(host, task.title, task.useYear ? year : '', uid, useTracker);

            log('request', movie.id, url);

            fetchText(url, function (err, body) {
                if (err || !body) return done(null);

                var results = parseTorrents(body);

                // Порожньо при активному &tracker= — можливо, сервер його не підтримує.
                // Пробуємо ще раз без нього; якщо цього разу щось є — більше не шлемо.
                if (!results.length && useTracker) {
                    var retryUrl = buildJacredUrl(host, task.title, task.useYear ? year : '', uid, false);
                    log('retry without tracker', movie.id, retryUrl);
                    return fetchText(retryUrl, function (e2, body2) {
                        if (e2 || !body2) return done(null);
                        var r2 = parseTorrents(body2);
                        if (r2.length) trackerParamBroken[host] = true;
                        done(r2.length ? analyzeTorrents(r2, movie, year) : null);
                    });
                }

                if (!results.length) return done(null);
                done(analyzeTorrents(results, movie, year));
            });
        }

        function step(i) {
            if (i >= tasks.length) return callback(emptyMarksData());
            runTask(tasks[i], function (data) {
                if (data && !data.empty) return callback(data);
                step(i + 1);
            });
        }

        step(0);
    }

    /* ------------------------------------------------------------------ *
     *  UAFIX (додаткова перевірка українського озвучення)
     * ------------------------------------------------------------------ */

    function checkUafixBandera(movie, callback) {
        var title = movie.title || movie.name || '';
        var origTitle = movie.original_title || movie.original_name || '';
        var imdbId = movie.imdb_id || '';
        var type = movie.name ? 'series' : 'movie';

        var url = 'https://banderabackend.lampame.v6.rocks/api/v2/search?source=uaflix';
        if (title) url += '&title=' + encodeURIComponent(title);
        if (origTitle) url += '&original_title=' + encodeURIComponent(origTitle);
        if (imdbId) url += '&imdb_id=' + encodeURIComponent(imdbId);
        url += '&type=' + type;

        try {
            var network = new Lampa.Reguest();
            network.timeout(5000);
            network.silent(url, function (json) {
                callback(Boolean(json && json.ok && json.items && json.items.length > 0));
            }, function () { callback(null); });
        } catch (e) { callback(null); }
    }

    function checkUafixDirect(movie, callback) {
        var query = movie.original_title || movie.original_name || movie.title || movie.name || '';
        if (!query) return callback(false);
        var searchUrl = 'https://uafix.net/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
        fetchText(searchUrl, function (err, html) {
            if (err || !html) return callback(false);
            var low = html.toLowerCase();
            var hasWord = low.indexOf('знайдено') >= 0 || low.indexOf('Р·РЅР°Р№РґРµРЅРѕ'.toLowerCase()) >= 0;
            var isZero = low.indexOf('0 відповідей') >= 0 || low.indexOf('0 РІС–РґРїРѕРІС–РґРµР№'.toLowerCase()) >= 0;
            callback(hasWord && !isZero);
        });
    }

    function checkUafix(movie, callback) {
        if (!isSettingEnabled('marks_uafix', false)) return callback(false);
        checkUafixBandera(movie, function (result) {
            if (result !== null) return callback(result);
            checkUafixDirect(movie, callback);
        });
    }

    /* ------------------------------------------------------------------ *
     *  RESOLVE + QUEUE
     * ------------------------------------------------------------------ */

    function pump() {
        while (active < MAX_PARALLEL && queue.length) run(queue.shift());
    }

    function run(task) {
        active++;
        var finished = false;

        function finish(data) {
            if (finished) return;
            finished = true;
            var result = data || emptyMarksData();
            setCache(task.key, result);
            var cbs = pending[task.key] || [];
            delete pending[task.key];
            for (var i = 0; i < cbs.length; i++) {
                try { cbs[i](result); } catch (e) { }
            }
            active--;
            pump();
        }

        jacredSearch(task.movie, function (data) {
            var res = data || emptyMarksData();
            if (!res.ukr) {
                checkUafix(task.movie, function (hasUafix) {
                    // uafix підтверджує лише наявність українського озвучення,
                    // роздільну звідти не беремо — інакше це вигадані дані
                    if (hasUafix) {
                        res.empty = false;
                        res.ukr = true;
                    }
                    finish(res);
                });
            } else finish(res);
        });
    }

    function resolveMarks(movie, callback) {
        if (!movie || !movie.id) return callback(emptyMarksData());

        var key = getCardType(movie) + '_' + movie.id;
        var cached = getCache(key);
        if (cached) return callback(cached);

        if (pending[key]) return pending[key].push(callback);

        pending[key] = [callback];
        queue.push({ key: key, movie: movie });
        pump();
    }

    /* ------------------------------------------------------------------ *
     *  RENDER (дизайн з marks.js — без змін)
     * ------------------------------------------------------------------ */

    function getMovieFromCard(cardNode) {
        var card = $(cardNode);
        return cardNode.heroMovieData || cardNode.card_data || card.data('item') || cardNode.item || null;
    }

    function extractRating(movie) {
        if (!movie) return 0;
        var candidates = [movie.imdb_rating, movie.kp_rating, movie.vote_average, movie.rating, movie.rate];
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i] === undefined || candidates[i] === null || candidates[i] === '') continue;
            var n = parseFloat(String(candidates[i]).replace(',', '.'));
            if (!isNaN(n) && n > 0) return n;
        }
        return 0;
    }

    function extractYear(movie) {
        if (!movie) return '';
        var raw = movie.release_date || movie.first_air_date || movie.year || '';
        var year = String(raw).substr(0, 4);
        return /^\d{4}$/.test(year) ? year : '';
    }

    function createCardBadge(cssClass, label) {
        var badge = document.createElement('div');
        badge.classList.add('likhtar-marks-badge');
        badge.classList.add('likhtar-marks-badge--' + cssClass);
        badge.textContent = label;
        return badge;
    }

    function renderCardBadges(container, data, movie, cardRoot) {
        container.empty();

        if (!isSettingEnabled('marks_enabled', true)) {
            if (cardRoot && cardRoot.length) cardRoot.removeClass('likhtar-marks-active likhtar-marks-has-custom-rating');
            return;
        }

        if (data.ukr && isSettingEnabled('marks_ua', true)) container.append(createCardBadge('ua', 'UA'));
        if (data.eng && isSettingEnabled('marks_en', true)) container.append(createCardBadge('en', 'EN'));

        if (data.resolution && data.resolution !== 'SD') {
            if (data.resolution === '4K' && isSettingEnabled('marks_4k', true)) {
                container.append(createCardBadge('4k', '4K'));
            } else if (data.resolution === 'FHD' && isSettingEnabled('marks_fhd', true)) {
                container.append(createCardBadge('fhd', '1080p'));
            } else if (data.resolution === 'HD' && isSettingEnabled('marks_fhd', true)) {
                container.append(createCardBadge('hd', '720p'));
            } else if (isSettingEnabled('marks_fhd', true)) {
                container.append(createCardBadge('hd', data.resolution));
            }
        }

        if (data.hdr && isSettingEnabled('marks_hdr', true)) {
            container.append(createCardBadge('hdr', data.dolbyVision ? 'DV' : 'HDR'));
        }

        var hasCustomRating = false;
        if (isSettingEnabled('marks_rating', true)) {
            var rating = extractRating(movie);
            if (rating > 0 && String(rating) !== '0.0') {
                var rBadge = document.createElement('div');
                rBadge.classList.add('likhtar-marks-badge', 'likhtar-marks-badge--rating');
                rBadge.innerHTML = '<span class="likhtar-marks-star">&#9733;</span>' + rating.toFixed(1);
                container.append(rBadge);
                hasCustomRating = true;
            }
        }

        if (isSettingEnabled('marks_year', true)) {
            var year = extractYear(movie);
            if (year) container.append(createCardBadge('year', year));
        }

        if (cardRoot && cardRoot.length) {
            if (hasCustomRating) cardRoot.addClass('likhtar-marks-has-custom-rating');
            else cardRoot.removeClass('likhtar-marks-has-custom-rating');

            if (container.children().length) cardRoot.addClass('likhtar-marks-active');
            else cardRoot.removeClass('likhtar-marks-active');
        }
    }

    function addMarksToCard(card, movie, viewSelector) {
        if (!isSettingEnabled('marks_enabled', true)) return;

        var containerParent = viewSelector ? card.find(viewSelector).first() : card;
        if (!containerParent.length) containerParent = card;
        if (containerParent.css('position') === 'static') containerParent.css('position', 'relative');

        var marksContainer = containerParent.find('.likhtar-marks-container').first();
        if (!marksContainer.length) {
            marksContainer = $('<div class="likhtar-marks-container"></div>');
            containerParent.append(marksContainer);
        }

        // рейтинг малюємо одразу, якість — після відповіді JacRed
        renderCardBadges(marksContainer, emptyMarksData(), movie, card);
        resolveMarks(movie, function (bestData) {
            if (!document.body.contains(card[0])) return;
            renderCardBadges(marksContainer, bestData, movie, card);
        });
    }

    function processCards(scopeNodes) {
        if (!isSettingEnabled('marks_enabled', true)) return;

        var cardsToProcess;
        if (scopeNodes && scopeNodes.length) {
            var cardNodes = [];
            for (var i = 0; i < scopeNodes.length; i++) {
                var node = scopeNodes[i];
                if (!node || node.nodeType !== 1) continue;
                if (node.matches && node.matches('.card')) cardNodes.push(node);
                var nested = node.querySelectorAll ? node.querySelectorAll('.card') : [];
                for (var j = 0; j < nested.length; j++) cardNodes.push(nested[j]);
            }
            cardsToProcess = $(cardNodes).not('.likhtar-marks-processed');
        } else {
            cardsToProcess = $('.card').not('.likhtar-marks-processed');
        }

        cardsToProcess.each(function () {
            var card = $(this);
            var movie = getMovieFromCard(this);
            if (!(movie && movie.id && !movie.size)) return;

            card.addClass('likhtar-marks-processed');
            if (card.hasClass('hero-banner')) addMarksToCard(card, movie, null);
            else addMarksToCard(card, movie, '.card__view');
        });
    }

    function renderFullBadges(container, data, movie) {
        container.empty();
        if (!isSettingEnabled('marks_enabled', true)) {
            container.remove();
            return;
        }

        if (data.ukr && isSettingEnabled('marks_ua', true)) {
            container.append('<div class="likhtar-marks-full-badge likhtar-marks-full-badge--ua">UA+</div>');
        }

        if (data.resolution && data.resolution !== 'SD') {
            var resText = data.resolution;
            if (resText === 'FHD') resText = '1080p';
            else if (resText === 'HD') resText = '720p';

            var showQuality = false;
            if (data.resolution === '4K' && isSettingEnabled('marks_4k', true)) showQuality = true;
            else if ((data.resolution === 'FHD' || data.resolution === 'HD') && isSettingEnabled('marks_fhd', true)) showQuality = true;

            if (showQuality) {
                container.append('<div class="likhtar-marks-full-badge likhtar-marks-full-badge--quality">' + resText + '</div>');
            }
        }

        if (data.hdr && isSettingEnabled('marks_hdr', true)) {
            container.append('<div class="likhtar-marks-full-badge likhtar-marks-full-badge--hdr">' + (data.dolbyVision ? 'Dolby Vision' : 'HDR') + '</div>');
        }

        if (isSettingEnabled('marks_rating', true)) {
            var rating = extractRating(movie);
            if (rating > 0 && String(rating) !== '0.0') {
                container.append('<div class="likhtar-marks-full-badge likhtar-marks-full-badge--rating">&#9733;' + rating.toFixed(1) + '</div>');
            }
        }

        if (isSettingEnabled('marks_year', true)) {
            var fullYear = extractYear(movie);
            if (fullYear) {
                container.append('<div class="likhtar-marks-full-badge likhtar-marks-full-badge--year">' + fullYear + '</div>');
            }
        }
    }

    function injectFullCardMarks(movie, renderEl) {
        if (!movie || !movie.id || !renderEl) return;

        var $render = $(renderEl);
        if ($render.is('.applecation') || $render.find('.applecation').length) return;
        if ($('.quality-badges-container').length) return;

        var poster = $render.find('.full-start__poster, .full-start-new__poster').first();
        if (poster.length) {
            if ($render.find('.likhtar-marks-full').length) return;
            poster.css('position', 'relative');
            var posterBadges = $('<div class="likhtar-marks-full"></div>');
            poster.append(posterBadges);

            renderFullBadges(posterBadges, emptyMarksData(), movie);
            resolveMarks(movie, function (bestData) { renderFullBadges(posterBadges, bestData, movie); });
        } else {
            var rateLine = $render.find('.full-start-new__rate-line, .full-start__rate-line').first();
            if (!rateLine.length) return;
            if ($render.find('.likhtar-marks-row').length) return;

            var qualityRow = $('<div class="likhtar-marks-row"></div>');
            rateLine.append(qualityRow);
            renderFullBadges(qualityRow, emptyMarksData(), movie);
            resolveMarks(movie, function (bestData) { renderFullBadges(qualityRow, bestData, movie); });
        }
    }

    /* ------------------------------------------------------------------ *
     *  OBSERVERS
     * ------------------------------------------------------------------ */

    function initCardObserver() {
        var queued = false;
        var pendingRoots = [];

        function scheduleProcess(mutations) {
            if (mutations && mutations.length) {
                for (var i = 0; i < mutations.length; i++) {
                    var added = mutations[i].addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        if (added[j] && added[j].nodeType === 1) pendingRoots.push(added[j]);
                    }
                }
            }
            if (queued) return;
            queued = true;
            setTimeout(function () {
                queued = false;
                if (pendingRoots.length) {
                    var batch = pendingRoots.slice(0);
                    pendingRoots = [];
                    processCards(batch);
                } else processCards();
            }, 80);
        }

        var observer = new MutationObserver(scheduleProcess);
        var target = document.getElementById('app') || document.body;
        observer.observe(target, { childList: true, subtree: true });

        processCards();
        setTimeout(processCards, 400);
        setTimeout(processCards, 1500);
    }

    function initFullCardObserver() {
        if (!Lampa.Listener || !Lampa.Listener.follow) return;

        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;
            var movie = e.data && e.data.movie;
            var renderEl = e.object && e.object.activity && e.object.activity.render && e.object.activity.render();
            injectFullCardMarks(movie, renderEl);
        });

        setTimeout(function () {
            try {
                var act = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
                if (!act || act.component !== 'full') return;
                var movie = act.card || act.movie;
                var renderEl = act.activity && act.activity.render && act.activity.render();
                injectFullCardMarks(movie, renderEl);
            } catch (err) { }
        }, 300);
    }

    function refreshAllMarks() {
        try {
            $('.likhtar-marks-container, .likhtar-marks-full, .likhtar-marks-row').remove();
            $('.card').removeClass('likhtar-marks-processed likhtar-marks-active likhtar-marks-has-custom-rating');
        } catch (e) { }

        if (!isSettingEnabled('marks_enabled', true)) return;

        try { processCards(); } catch (e2) { }

        try {
            var act = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
            if (act && act.component === 'full') {
                var movie = act.card || act.movie;
                var renderEl = act.activity && act.activity.render && act.activity.render();
                injectFullCardMarks(movie, renderEl);
            }
        } catch (e3) { }
    }

    /* ------------------------------------------------------------------ *
     *  SETTINGS
     * ------------------------------------------------------------------ */

    function setupSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;
        if (window.marks_quality_settings_added) return;
        window.marks_quality_settings_added = true;

        var component = 'interface';
        var migrateKey = 'marks_merged_migrated_v2';

        if (!Lampa.Storage.get(migrateKey, false)) {
            Lampa.Storage.set('marks_enabled', true);
            Lampa.Storage.set('marks_ua', true);
            Lampa.Storage.set('marks_en', true);
            Lampa.Storage.set('marks_4k', true);
            Lampa.Storage.set('marks_fhd', true);
            Lampa.Storage.set('marks_hdr', true);
            Lampa.Storage.set('marks_rating', true);
            Lampa.Storage.set('marks_year', true);
            Lampa.Storage.set('marks_uafix', false);
            Lampa.Storage.set('marks_jacred_fallback', true);
            if (!Lampa.Storage.get('marks_jacred_url', '')) Lampa.Storage.set('marks_jacred_url', 'auto');
            Lampa.Storage.set(migrateKey, true);
        }

        var refresh = function () { setTimeout(refreshAllMarks, 50); };

        Lampa.SettingsApi.addParam({
            component: component,
            param: { type: 'title' },
            field: { name: 'Мітки (Marks)' }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_enabled', type: 'trigger', default: true },
            field: { name: 'Увімкнути модуль міток' },
            onChange: refresh
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_ua', type: 'trigger', default: true },
            field: { name: 'Показувати мітку UA' },
            onChange: refresh
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_en', type: 'trigger', default: true },
            field: { name: 'Показувати мітку EN' },
            onChange: refresh
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_4k', type: 'trigger', default: true },
            field: { name: 'Показувати мітку 4K' },
            onChange: refresh
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_fhd', type: 'trigger', default: true },
            field: { name: 'Показувати мітки 1080p / 720p' },
            onChange: refresh
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_hdr', type: 'trigger', default: true },
            field: { name: 'Показувати мітку HDR / Dolby Vision' },
            onChange: refresh
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_rating', type: 'trigger', default: true },
            field: { name: 'Показувати мітку рейтингу' },
            onChange: refresh
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_year', type: 'trigger', default: true },
            field: { name: 'Показувати мітку року' },
            onChange: refresh
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_uafix', type: 'trigger', default: false },
            field: {
                name: 'Додаткова перевірка UA (uafix)',
                description: 'Вмикати, якщо мітка UA рідко зʼявляється. Сповільнює завантаження.'
            },
            onChange: function () { clearCache(); refresh(); }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: {
                name: 'marks_jacred_url',
                type: 'input',
                values: '',
                placeholder: 'auto',
                default: 'auto'
            },
            field: {
                name: 'Джерело якості',
                description: '«auto» — брати адресу з налаштувань торент-парсера LAMPA (LampaUA / SpawnUA / Jac.red). Або вписати адресу вручну.'
            },
            onChange: function () { clearCache(); refresh(); }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_jacred_fallback', type: 'trigger', default: true },
            field: {
                name: 'Резервне джерело (' + DEFAULT_JACRED + ')',
                description: 'Використовувати, якщо основне джерело не відповідає'
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
     *  STYLE (з marks.js — без змін)
     * ------------------------------------------------------------------ */

    function injectStyle() {
        if (document.getElementById('likhtar-marks-style-v1')) return;

        var style = document.createElement('style');
        style.id = 'likhtar-marks-style-v1';
        style.innerHTML = '\
            .likhtar-marks-container {\
                position: absolute;\
                top: 1.4em;\
                left: -0.2em;\
                display: flex;\
                flex-direction: column;\
                gap: 0.2em;\
                z-index: 20;\
                pointer-events: none;\
            }\
            .hero-banner .likhtar-marks-container {\
                top: 1.5em;\
                left: 1.2em;\
                gap: 0.3em;\
            }\
            .likhtar-marks-badge {\
                padding: 0.32em 0.48em;\
                font-size: 0.78em;\
                font-weight: 800;\
                line-height: 1;\
                letter-spacing: 0.03em;\
                border-radius: 0.32em;\
                display: inline-flex;\
                align-items: center;\
                justify-content: center;\
                align-self: flex-start;\
                border: 1px solid rgba(255,255,255,0.16);\
                box-shadow: 0 1px 5px rgba(0,0,0,0.35);\
                color: #fff;\
                white-space: nowrap;\
            }\
            .likhtar-marks-badge--ua  { background: linear-gradient(135deg, #1565c0, #42a5f5); border-color: rgba(66,165,245,0.4); }\
            .likhtar-marks-badge--en  { background: linear-gradient(135deg, #37474f, #78909c); border-color: rgba(120,144,156,0.4); }\
            .likhtar-marks-badge--4k  { background: linear-gradient(135deg, #e65100, #ff9800); border-color: rgba(255,152,0,0.4); }\
            .likhtar-marks-badge--fhd { background: linear-gradient(135deg, #4a148c, #ab47bc); border-color: rgba(171,71,188,0.4); }\
            .likhtar-marks-badge--hd  { background: linear-gradient(135deg, #1b5e20, #66bb6a); border-color: rgba(102,187,106,0.4); }\
            .likhtar-marks-badge--hdr { background: linear-gradient(135deg, #f57f17, #ffeb3b); color: #000; border-color: rgba(255,235,59,0.4); }\
            .likhtar-marks-badge--rating { background: linear-gradient(135deg, #1a1a2e, #16213e); color: #ffd700; border-color: rgba(255,215,0,0.35); }\
            .likhtar-marks-badge--year { background: linear-gradient(135deg, #212121, #4e4e4e); color: #fff; border-color: rgba(255,255,255,0.28); }\
            .likhtar-marks-star { margin-right: 0.16em; font-size: 0.92em; }\
            .card.likhtar-marks-active .card__type,\
            .card.likhtar-marks-active .card__quality { display: none !important; }\
            .card.likhtar-marks-has-custom-rating .card__vote { display: none !important; }\
            .likhtar-marks-full {\
                position: absolute;\
                top: 0.8em;\
                right: 0.2em;\
                display: flex;\
                flex-direction: column;\
                gap: 0.3em;\
                z-index: 20;\
                pointer-events: none;\
            }\
            .likhtar-marks-row {\
                display: inline-flex;\
                align-items: center;\
                gap: 0.4em;\
                flex-wrap: wrap;\
            }\
            .likhtar-marks-full-badge {\
                display: inline-flex;\
                align-items: center;\
                justify-content: center;\
                padding: 0.25em 0.5em;\
                border-radius: 0.3em;\
                border: 1px solid rgba(255,255,255,0.2);\
                font-size: 0.75em;\
                font-weight: 800;\
                line-height: 1;\
                letter-spacing: 0.04em;\
                color: #fff;\
                box-shadow: 0 2px 6px rgba(0,0,0,0.4);\
            }\
            .likhtar-marks-full-badge--ua { background: linear-gradient(135deg, #1565c0, #42a5f5); border-color: rgba(66,165,245,0.4); }\
            .likhtar-marks-full-badge--quality { background: linear-gradient(135deg, #2e7d32, #66bb6a); border-color: rgba(102,187,106,0.4); }\
            .likhtar-marks-full-badge--hdr { background: linear-gradient(135deg, #512da8, #ab47bc); border-color: rgba(171,71,188,0.4); }\
            .likhtar-marks-full-badge--rating { background: linear-gradient(135deg, #1a1a2e, #16213e); color: #ffd700; border-color: rgba(255,215,0,0.35); }\
            .likhtar-marks-full-badge--year { background: linear-gradient(135deg, #212121, #4e4e4e); color: #fff; border-color: rgba(255,255,255,0.28); }\
        ';

        document.head.appendChild(style);
    }

    /* ------------------------------------------------------------------ *
     *  INIT
     * ------------------------------------------------------------------ */

    function runInit() {
        setupSettings();
        injectStyle();
        window.MARKS_REFRESH = refreshAllMarks;
        window.MARKS_CLEAR_CACHE = clearCache;
        initCardObserver();
        initFullCardObserver();
        setTimeout(refreshAllMarks, 50);
    }

    if (window.appready) runInit();
    else if (Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') runInit(); });
    } else setTimeout(runInit, 1200);
})();
