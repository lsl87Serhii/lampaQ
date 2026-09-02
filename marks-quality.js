(function () {
    'use strict';

    if (window.marks_quality_merged_v15) return;
    window.marks_quality_merged_v15 = true;

    if (typeof Lampa === 'undefined') {
        console.warn('Marks+Quality: Lampa not found');
        return;
    }

    window.MARKS_QUALITY_VERSION = 15;

    /* ------------------------------------------------------------------ *
     *  CONFIG & CACHE
     * ------------------------------------------------------------------ */

    var LOG = false;
    var DEFAULT_HOST = 'http://jackettua.mooo.com';
    var CACHE_KEY = 'marks_quality_cache_v15';
    var CACHE_TIME = 12 * 60 * 60 * 1000;              // 12 годин
    var CACHE_LIMIT = 800;
    var REQ_TIMEOUT = 15000;                           // Таймаут 15 сек під SpawnUA
    var MAX_PARALLEL = 3;
    var RES_ORDER = ['SD', 'HD', 'FHD', '2K', '4K'];

    var UA_TRACKERS = ['toloka', 'toloka.to', 'mazepa', 'hurtom', 'uafilm', 'baibako', 'ua-tracker', 'mova'];

    var memCache = {};
    var pending = {};
    var queue = [];
    var active = 0;

    function log() {
        if (LOG) console.log.apply(console, ['MARKS+Q'].concat([].slice.call(arguments)));
    }

    /* ------------------------------------------------------------------ *
     *  HELPERS & PARSER CONFIG DETECTION
     * ------------------------------------------------------------------ */

    function normalizeHost(raw) {
        raw = String(raw || '').trim();
        if (!raw) return '';
        var proto = /^https:\/\//i.test(raw) ? 'https://' : 'http://';
        raw = raw.replace(/^https?:\/\//i, '')
                 .replace(/\/api\/.*$/i, '')
                 .replace(/\/+$/, '');
        return raw ? (proto + raw) : '';
    }

    function cleanTitle(raw) {
        return String(raw || '')
            .replace(/[!\?\:\–\—\.\,\_\/]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeSettingBoolean(val, defaultVal) {
        if (val === undefined || val === null || val === '') return !!defaultVal;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val !== 0;
        if (typeof val === 'string') {
            var t = val.trim().toLowerCase();
            if (t === 'false' || t === '0' || t === 'off' || t === 'no' || t === 'disabled') return false;
            if (t === 'true' || t === '1' || t === 'on' || t === 'yes' || t === 'enabled') return true;
        }
        return !!val;
    }

    function isSettingEnabled(key, defaultVal) {
        return normalizeSettingBoolean(Lampa.Storage.get(key, defaultVal), defaultVal);
    }

    function getParserConfig() {
        var hosts = [];
        var key = 'ua';

        var customSetting = String(Lampa.Storage.get('marks_jacred_url', 'auto') || 'auto').trim();
        if (customSetting && customSetting.toLowerCase() !== 'auto') {
            var manual = normalizeHost(customSetting);
            if (manual) hosts.push(manual);
        }

        var urlKeys = [
            'jackett_url',
            'spawnua_url',
            'lampaua_url',
            'parser_torrent_url',
            'jacred_url',
            'jackett_urltwo',
            'parser_url'
        ];

        for (var i = 0; i < urlKeys.length; i++) {
            var v = Lampa.Storage.get(urlKeys[i], '');
            if (v && typeof v === 'string' && v.trim()) {
                var host = normalizeHost(v);
                if (host && hosts.indexOf(host) === -1) hosts.push(host);
            }
        }

        if (typeof Lampa !== 'undefined' && Lampa.Parser) {
            try {
                var pUrl = typeof Lampa.Parser.url === 'function' ? Lampa.Parser.url() : Lampa.Parser.url;
                if (pUrl) {
                    var normP = normalizeHost(pUrl);
                    if (normP && hosts.indexOf(normP) === -1) hosts.push(normP);
                }
            } catch (e) {}
        }

        var keyKeys = ['jackett_key', 'spawnua_key', 'parser_key', 'jacred_key'];
        for (var j = 0; j < keyKeys.length; j++) {
            var k = Lampa.Storage.get(keyKeys[j], '');
            if (k && typeof k === 'string' && k.trim()) {
                key = k.trim();
                break;
            }
        }

        if (!hosts.length) hosts.push(normalizeHost(DEFAULT_HOST));

        return { hosts: hosts, key: key };
    }

    /* ------------------------------------------------------------------ *
     *  CACHE MANAGEMENT
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
     *  NETWORK REQUESTS
     * ------------------------------------------------------------------ */

    function fetchUrl(url, callback) {
        try {
            var network = new Lampa.Reguest();
            network.timeout(REQ_TIMEOUT);
            network.silent(url, function (res) {
                if (res) callback(null, res);
                else callback(new Error('Empty response'));
            }, function (err) {
                callback(err || new Error('Request failed'));
            });
        } catch (e) {
            callback(e);
        }
    }

    /* ------------------------------------------------------------------ *
     *  TORRENT PARSING & RESOLUTION DETECTOR
     * ------------------------------------------------------------------ */

    function emptyMarksData() {
        return { empty: true, resolution: '', ukr: false, eng: false, hdr: false, dolbyVision: false };
    }

    function getCardType(card) {
        var type = card.media_type || card.type;
        if (type === 'movie' || type === 'tv') return type;
        return (card.name || card.original_name) ? 'tv' : 'movie';
    }

    function parseTorrents(body) {
        if (!body) return [];
        if (Array.isArray(body)) return body;

        var parsed = null;
        if (typeof body === 'string') {
            try { parsed = JSON.parse(body); } catch (e) { return []; }
        } else {
            parsed = body;
        }

        if (!parsed) return [];
        if (Array.isArray(parsed)) return parsed;
        if (parsed.contents) return parseTorrents(parsed.contents);
        if (Array.isArray(parsed.Results)) return parsed.Results;
        if (Array.isArray(parsed.results)) return parsed.results;
        if (Array.isArray(parsed.items)) return parsed.items;
        if (Array.isArray(parsed.torrents)) return parsed.torrents;
        if (Array.isArray(parsed.data)) return parsed.data;

        return [];
    }

    function detectResolution(item) {
        if (!item) return 'FHD';

        var qStr = String(item.quality || item.Quality || item.resolution || item.Resolution || '').toLowerCase();
        var qNum = parseInt(qStr, 10) || 0;

        var title = String(item.title || item.Title || item.name || item.Name || '').toLowerCase();
        var desc = String(item.description || item.Description || item.details || '').toLowerCase();
        var fullText = title + ' ' + desc + ' ' + qStr;

        if (qNum >= 2160 || /(2160|4k|uhd|ultra\s*hd)/i.test(fullText)) return '4K';
        if (qNum === 1440 || /(1440|2k|qhd)/i.test(fullText)) return '2K';
        if (qNum === 1080 || /(1080|fhd|full\s*hd)/i.test(fullText)) return 'FHD';
        if (qNum === 720 || /(720|hdrip|hdtv)/i.test(fullText)) return 'HD';
        if ((qNum > 0 && qNum <= 576) || /(480|576|sd|dvdrip|vhsrip)/i.test(fullText)) return 'SD';

        return 'FHD';
    }

    function extractTorrentYears(item) {
        var years = [];
        var direct = parseInt(item && (item.relased || item.released || item.year), 10);
        if (direct >= 1900 && direct <= 2030) years.push(direct);

        var t = String(item && (item.title || item.Title) || '');
        var matches = t.match(/(?:^|[^0-9])(19\d{2}|20\d{2})(?:[^0-9]|$)/g);
        if (matches) {
            matches.forEach(function (m) {
                var y = parseInt(m.replace(/[^0-9]/g, ''), 10);
                if (y >= 1900 && y <= 2030 && years.indexOf(y) === -1) years.push(y);
            });
        }
        return years;
    }

    function analyzeTorrents(results, movie, wantYear) {
        var best = emptyMarksData();
        var bestResIndex = -1;
        var found = false;

        results.forEach(function (item) {
            if (!item) return;

            if (wantYear) {
                var tYears = extractTorrentYears(item);
                if (tYears.length > 0) {
                    var matchesYear = tYears.some(function (y) {
                        return Math.abs(y - wantYear) <= 1;
                    });
                    if (!matchesYear) return;
                }
            }

            var t = String(item.title || item.Title || item.name || '').toLowerCase();
            if (/(^|[^a-zа-яіїєґ])(ts|telesync|camrip|cam|tc|screener)([^a-zа-яіїєґ]|$)/i.test(t)) return;

            found = true;
            if (/(eng|english|multi)/i.test(t)) best.eng = true;

            var res = detectResolution(item);
            var resIndex = RES_ORDER.indexOf(res);

            if (resIndex >= bestResIndex) {
                bestResIndex = resIndex;
                best.resolution = res;

                var isDv = t.indexOf('dolby vision') >= 0 || t.indexOf('dolbyvision') >= 0 || /(^|[^a-z])dovi([^a-z]|$)/i.test(t);
                var videoType = String(item.videotype || item.VideoType || '').toLowerCase();

                if (isDv) {
                    best.dolbyVision = true;
                    best.hdr = true;
                } else if (videoType === 'hdr' || /(hdr10\+|hdr10|hdr)/i.test(t)) {
                    best.hdr = true;
                }
            }
        });

        if (!found) return emptyMarksData();

        best.ukr = true;
        best.empty = false;
        return best;
    }

    /* ------------------------------------------------------------------ *
     *  SEARCH PROCESSOR
     * ------------------------------------------------------------------ */

    function buildUrls(host, title, apiKey) {
        var encoded = encodeURIComponent(title);
        var list = [];
        list.push(host + '/api/v2.0/indexers/all/results?apikey=' + encodeURIComponent(apiKey) + '&Query=' + encoded);
        list.push(host + '/api/v2.0/indexers/all/results/torznab/api?apikey=' + encodeURIComponent(apiKey) + '&t=search&q=' + encoded);
        return list;
    }

    function fallbackSearch(movie, yearNum, callback) {
        var config = getParserConfig();
        var apiKey = config.key;
        var hosts = config.hosts;

        var titles = [];
        var loc = cleanTitle(movie.title || movie.name);
        var orig = cleanTitle(movie.original_title || movie.original_name);

        if (loc && /[a-zа-яєіїґ0-9]/i.test(loc)) titles.push(loc);
        if (orig && orig !== loc && /[a-zа-яєіїґ0-9]/i.test(orig)) titles.push(orig);

        if (!titles.length || !hosts.length) return callback(emptyMarksData());

        var tasks = [];
        for (var h = 0; h < hosts.length; h++) {
            for (var t = 0; t < titles.length; t++) {
                var urls = buildUrls(hosts[h], titles[t], apiKey);
                for (var u = 0; u < urls.length; u++) {
                    tasks.push({ host: hosts[h], url: urls[u] });
                }
            }
        }

        function runTask(index) {
            if (index >= tasks.length) return callback(emptyMarksData());

            var task = tasks[index];
            log('request', movie.id, task.url);

            fetchUrl(task.url, function (err, body) {
                if (err || !body) return runTask(index + 1);

                var results = parseTorrents(body);
                if (!results.length) return runTask(index + 1);

                var data = analyzeTorrents(results, movie, yearNum);
                if (data && !data.empty) return callback(data);

                runTask(index + 1);
            });
        }

        runTask(0);
    }

    function searchTorrentsForMovie(movie, callback) {
        var dateRaw = movie.release_date || movie.first_air_date || movie.year || '';
        var yearStr = String(dateRaw).substr(0, 4);
        var yearNum = /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : 0;

        if (typeof Lampa !== 'undefined' && Lampa.Jackett && typeof Lampa.Jackett.search === 'function') {
            try {
                Lampa.Jackett.search(movie, function (res) {
                    var items = parseTorrents(res);
                    if (items && items.length) {
                        var data = analyzeTorrents(items, movie, yearNum);
                        if (data && !data.empty) return callback(data);
                    }
                    fallbackSearch(movie, yearNum, callback);
                }, function () {
                    fallbackSearch(movie, yearNum, callback);
                });
                return;
            } catch (e) { }
        }

        fallbackSearch(movie, yearNum, callback);
    }

    /* ------------------------------------------------------------------ *
     *  QUEUE & RENDERING
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

        searchTorrentsForMovie(task.movie, finish);
    }

    function resolveMarks(movie, callback) {
        if (!movie || (!movie.id && !movie.kp_id && !movie.imdb_id)) return callback(emptyMarksData());

        var id = movie.id || movie.kp_id || movie.imdb_id;
        var key = getCardType(movie) + '_' + id;
        var cached = getCache(key);
        if (cached) return callback(cached);

        if (pending[key]) return pending[key].push(callback);

        pending[key] = [callback];
        queue.push({ key: key, movie: movie });
        pump();
    }

    function getMovieFromCard(cardNode) {
        if (!cardNode) return null;
        var $card = $(cardNode);
        return cardNode.heroMovieData ||
               cardNode.card_data ||
               cardNode.item ||
               cardNode.data ||
               $card.data('item') ||
               $card.data('data') ||
               $card.data('card_data') ||
               null;
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

        if (cardRoot && cardRoot.length) {
            cardRoot.find('.card__vote, .card__rate, div[class*="card__vote"]').remove();
        }

        if (!isSettingEnabled('marks_enabled', true)) {
            if (cardRoot && cardRoot.length) cardRoot.removeClass('likhtar-marks-active likhtar-marks-has-custom-rating');
            return;
        }

        // ЯКЩО ТОРЕНТІВ НЕ ЗНАЙДЕНО — ПОСТЕР ЗАЛИШАЄТЬСЯ ЧИСТИМ
        if (data.empty) {
            if (cardRoot && cardRoot.length) cardRoot.removeClass('likhtar-marks-active likhtar-marks-has-custom-rating');
            return;
        }

        if (data.ukr && isSettingEnabled('marks_ua', true)) container.append(createCardBadge('ua', 'UA'));
        if (data.eng && isSettingEnabled('marks_en', true)) container.append(createCardBadge('en', 'EN'));

        if (data.resolution) {
            if (data.resolution === '4K' && isSettingEnabled('marks_4k', true)) {
                container.append(createCardBadge('4k', '4K'));
            } else if (data.resolution === '2K' && isSettingEnabled('marks_fhd', true)) {
                container.append(createCardBadge('fhd', '2K'));
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

        card.find('.card__vote, .card__rate, div[class*="card__vote"]').remove();

        var containerParent = viewSelector ? card.find(viewSelector).first() : card;
        if (!containerParent.length) containerParent = card;
        if (containerParent.css('position') === 'static') containerParent.css('position', 'relative');

        var marksContainer = containerParent.find('.likhtar-marks-container').first();
        if (!marksContainer.length) {
            marksContainer = $('<div class="likhtar-marks-container"></div>');
            containerParent.append(marksContainer);
        }

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

            card.find('.card__vote, .card__rate, div[class*="card__vote"]').remove();

            var movie = getMovieFromCard(this);
            if (!movie || (!movie.id && !movie.kp_id && !movie.imdb_id)) return;

            card.addClass('likhtar-marks-processed');
            if (card.hasClass('hero-banner')) addMarksToCard(card, movie, null);
            else addMarksToCard(card, movie, '.card__view');
        });
    }

    function refreshAllMarks() {
        try {
            $('.likhtar-marks-container, .likhtar-marks-full, .likhtar-marks-row').remove();
            $('.card').removeClass('likhtar-marks-processed likhtar-marks-active likhtar-marks-has-custom-rating');
        } catch (e) { }

        if (!isSettingEnabled('marks_enabled', true)) return;
        try { processCards(); } catch (e2) { }
    }

    /* ------------------------------------------------------------------ *
     *  SETTINGS & STYLES
     * ------------------------------------------------------------------ */

    function setupSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;
        if (window.marks_quality_settings_added) return;
        window.marks_quality_settings_added = true;

        var component = 'interface';

        Lampa.SettingsApi.addParam({
            component: component,
            param: { type: 'title' },
            field: { name: 'Мітки якості (Marks)' }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_enabled', type: 'trigger', default: true },
            field: { name: 'Увімкнути модуль міток' },
            onChange: function () { setTimeout(refreshAllMarks, 50); }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_ua', type: 'trigger', default: true },
            field: { name: 'Показувати мітку UA' },
            onChange: function () { setTimeout(refreshAllMarks, 50); }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_4k', type: 'trigger', default: true },
            field: { name: 'Показувати мітку 4K' },
            onChange: function () { setTimeout(refreshAllMarks, 50); }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_fhd', type: 'trigger', default: true },
            field: { name: 'Показувати мітки 1080p / 720p' },
            onChange: function () { setTimeout(refreshAllMarks, 50); }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_rating', type: 'trigger', default: true },
            field: { name: 'Показувати мітку рейтингу' },
            onChange: function () { setTimeout(refreshAllMarks, 50); }
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
                description: '«auto» — читати адрес з налаштувань парсера Lampa, або введіть адрес вручну'
            },
            onChange: function () { clearCache(); refreshAllMarks(); }
        });

        Lampa.SettingsApi.addParam({
            component: component,
            param: { name: 'marks_cache_clear', type: 'button' },
            field: { name: 'Очистити кеш міток', description: 'Скинути збережені дані про якість' },
            onChange: function () {
                clearCache();
                if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Кеш очищено');
                refreshAllMarks();
            }
        });
    }

    function initCardObserver() {
        var queued = false;

        function scheduleProcess() {
            if (queued) return;
            queued = true;
            setTimeout(function () {
                queued = false;
                processCards();
            }, 100);
        }

        var observer = new MutationObserver(scheduleProcess);
        var target = document.getElementById('app') || document.body;
        observer.observe(target, { childList: true, subtree: true });

        processCards();
        setInterval(processCards, 800);
    }

    function injectStyle() {
        if (document.getElementById('likhtar-marks-style-v15')) return;

        var style = document.createElement('style');
        style.id = 'likhtar-marks-style-v15';
        style.type = 'text/css';
        style.innerHTML = '\
            body .card__vote, body .card__rate, body div[class*="card__vote"], body div[class*="card__rate"] {\
                display: none !important;\
                opacity: 0 !important;\
                visibility: hidden !important;\
                width: 0 !important;\
                height: 0 !important;\
                margin: 0 !important;\
                padding: 0 !important;\
                overflow: hidden !important;\
                pointer-events: none !important;\
            }\
            .likhtar-marks-container {\
                position: absolute;\
                top: 0.5em;\
                left: 0.4em;\
                display: flex;\
                flex-direction: column;\
                gap: 0.2em;\
                z-index: 20;\
                pointer-events: none;\
            }\
            .likhtar-marks-badge {\
                padding: 0.3em 0.45em;\
                font-size: 0.75em;\
                font-weight: 800;\
                line-height: 1;\
                border-radius: 0.3em;\
                display: inline-flex;\
                align-items: center;\
                justify-content: center;\
                border: 1px solid rgba(255,255,255,0.2);\
                box-shadow: 0 2px 5px rgba(0,0,0,0.5);\
                color: #fff;\
            }\
            .likhtar-marks-badge--ua  { background: linear-gradient(135deg, #1565c0, #42a5f5); }\
            .likhtar-marks-badge--en  { background: linear-gradient(135deg, #37474f, #78909c); }\
            .likhtar-marks-badge--4k  { background: linear-gradient(135deg, #e65100, #ff9800); }\
            .likhtar-marks-badge--fhd { background: linear-gradient(135deg, #4a148c, #ab47bc); }\
            .likhtar-marks-badge--hd  { background: linear-gradient(135deg, #1b5e20, #66bb6a); }\
            .likhtar-marks-badge--hdr { background: linear-gradient(135deg, #f57f17, #ffeb3b); color: #000; }\
            .likhtar-marks-badge--rating { background: linear-gradient(135deg, #1a1a2e, #16213e); color: #ffd700; }\
            .likhtar-marks-badge--year { background: linear-gradient(135deg, #212121, #4e4e4e); }\
            .likhtar-marks-star { margin-right: 0.15em; }\
            .card.likhtar-marks-active .card__type,\
            .card.likhtar-marks-active .card__quality { display: none !important; }\
        ';

        (document.head || document.documentElement).appendChild(style);
    }

    /* ------------------------------------------------------------------ *
     *  INIT
     * ------------------------------------------------------------------ */

    function runInit() {
        setupSettings();
        clearCache();
        injectStyle();
        initCardObserver();
        processCards();

        if (Lampa.Listener && Lampa.Listener.follow) {
            Lampa.Listener.follow('activity', function (e) {
                if (e.type === 'render' || e.type === 'build') {
                    setTimeout(processCards, 150);
                    setTimeout(processCards, 500);
                }
            });
        }
    }

    if (window.appready) runInit();
    else if (Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') runInit(); });
    } else setTimeout(runInit, 1000);
})();