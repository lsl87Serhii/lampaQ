(function () {
    'use strict';

    if (window.marks_quality_merged_v6) return;
    window.marks_quality_merged_v6 = true;

    if (typeof Lampa === 'undefined') {
        console.warn('Marks+Quality: Lampa not found');
        return;
    }

    /* ------------------------------------------------------------------ *
     *  CONFIG & CACHE
     * ------------------------------------------------------------------ */

    var LOG = false;
    var DEFAULT_HOST = 'http://jackettua.mooo.com';
    var CACHE_KEY = 'marks_quality_cache_v6';
    var CACHE_TIME = 12 * 60 * 60 * 1000;              // 12 годин
    var CACHE_LIMIT = 800;
    var REQ_TIMEOUT = 6000;
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
     *  HOST & API KEY DETECTION
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

    function isSettingEnabled(key, defaultVal) {
        var val = Lampa.Storage.get(key, defaultVal);
        if (val === undefined || val === null || val === '') return !!defaultVal;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
            var t = val.trim().toLowerCase();
            if (t === 'false' || t === '0' || t === 'off' || t === 'no' || t === 'disabled') return false;
            if (t === 'true' || t === '1' || t === 'on' || t === 'yes' || t === 'enabled') return true;
        }
        return !!val;
    }

    function getApiKey() {
        var keys = ['jackett_key', 'parser_key', 'jacred_key'];
        for (var i = 0; i < keys.length; i++) {
            var k = Lampa.Storage.get(keys[i], '');
            if (k && typeof k === 'string' && k.trim()) return k.trim();
        }
        return 'ua'; // За замовчуванням для LampaUA
    }

    function getActiveParserHosts() {
        var list = [];

        var customSetting = String(Lampa.Storage.get('marks_jacred_url', 'auto') || 'auto').trim();
        if (customSetting && customSetting.toLowerCase() !== 'auto') {
            var manual = normalizeHost(customSetting);
            if (manual) list.push(manual);
        }

        var keys = [
            'jackett_url',
            'lampaua_url',
            'spawnua_url',
            'jacred_url',
            'parser_torrent_url',
            'jackett_urltwo',
            'parser_url'
        ];

        for (var i = 0; i < keys.length; i++) {
            var v = Lampa.Storage.get(keys[i], '');
            if (v && typeof v === 'string' && v.trim()) {
                var host = normalizeHost(v);
                if (host && list.indexOf(host) === -1) list.push(host);
            }
        }

        if (typeof Lampa.Parser !== 'undefined') {
            try {
                var pUrl = typeof Lampa.Parser.url === 'function' ? Lampa.Parser.url() : Lampa.Parser.url;
                if (pUrl) {
                    var normPUrl = normalizeHost(pUrl);
                    if (normPUrl && list.indexOf(normPUrl) === -1) list.push(normPUrl);
                }
            } catch (e) {}
        }

        if (!list.length) {
            var fb = normalizeHost(DEFAULT_HOST);
            if (fb) list.push(fb);
        }

        return list;
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
     *  NETWORK
     * ------------------------------------------------------------------ */

    function fetchUrl(url, callback) {
        try {
            var network = new Lampa.Reguest();
            network.timeout(REQ_TIMEOUT);
            network.silent(url, function (res) {
                if (typeof res === 'object') callback(null, JSON.stringify(res));
                else if (typeof res === 'string') callback(null, res);
                else callback(new Error('Empty response'));
            }, function (err) {
                callback(err || new Error('Request failed'));
            });
        } catch (e) {
            callback(e);
        }
    }

    /* ------------------------------------------------------------------ *
     *  TORRENT PARSING & MATCHING
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
        try { parsed = typeof body === 'string' ? JSON.parse(body) : body; } catch (e) { return []; }
        if (parsed && parsed.contents) {
            try { parsed = JSON.parse(parsed.contents); } catch (e2) { }
        }
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.Results)) return parsed.Results;
        return [];
    }

    function isUaRelease(item, host) {
        if (!item) return false;

        // Якщо це сервер LampaUA / JackettUA, всі видані релізи є українськими
        if (host && (host.indexOf('jackettua') >= 0 || host.indexOf('lampaua') >= 0 || host.indexOf('spawnua') >= 0)) {
            return true;
        }

        var fields = [
            item.trackerName, item.TrackerName,
            item.tracker, item.Tracker,
            item.url, item.Details, item.Comments
        ];

        for (var i = 0; i < fields.length; i++) {
            var v = String(fields[i] || '').toLowerCase();
            if (!v) continue;
            for (var j = 0; j < UA_TRACKERS.length; j++) {
                if (v.indexOf(UA_TRACKERS[j]) >= 0) return true;
            }
        }

        var t = String(item.title || item.Title || '').toLowerCase();
        return /(^|[\s\.\_\-\[\(\/])(ukr|ua|ukrainian|укр|українськ)([\s\.\_\-\]\)\/]|$)/i.test(t);
    }

    function detectResolution(item) {
        var t = String(item && (item.title || item.Title) || '').toLowerCase();
        var b = '(?:^|[^a-z0-9а-яіїєґ])';
        var e = '(?:[^a-z0-9а-яіїєґ]|$)';

        if (new RegExp(b + '(2160[pi]?|4k|uhd)' + e, 'i').test(t)) return '4K';
        if (new RegExp(b + '(1440[pi]?|2k)' + e, 'i').test(t)) return '2K';
        if (new RegExp(b + '(1080[pi]?|fhd|full ?hd)' + e, 'i').test(t)) return 'FHD';
        if (new RegExp(b + '(720[pi]?|hdrip|hdtv)' + e, 'i').test(t)) return 'HD';
        if (new RegExp(b + '(480[pi]?|360[pi]?|sd|dvdrip|vhsrip)' + e, 'i').test(t)) return 'SD';

        var q = parseInt(item && (item.quality || item.Quality), 10) || 0;
        if (q >= 2160) return '4K';
        if (q >= 1440) return '2K';
        if (q >= 1080) return 'FHD';
        if (q >= 720) return 'HD';
        return '';
    }

    function releaseYear(item) {
        var direct = parseInt(item && (item.relased || item.released || item.year || item.PublishDate), 10);
        if (direct >= 1900 && direct <= 2030) return direct;
        var t = String(item && (item.title || item.Title) || '');
        var m = t.match(/(^|[^0-9])(19|20)(\d{2})([^0-9]|$)/);
        if (m) return parseInt(m[2] + m[3], 10);
        return 0;
    }

    function analyzeTorrents(results, movie, wantYear, host) {
        var best = emptyMarksData();
        var bestRes = '';
        var found = false;

        results.forEach(function (item) {
            if (!isUaRelease(item, host)) return;

            if (wantYear) {
                var ry = releaseYear(item);
                if (ry && Math.abs(ry - wantYear) > 1) return;
            }

            var t = String(item && (item.title || item.Title) || '').toLowerCase();
            if (/(^|[^a-zа-яіїєґ])(ts|telesync|camrip|cam|tc|screener)([^a-zа-яіїєґ]|$)/i.test(t)) return;

            found = true;
            if (/(^|[^a-z])(eng|english|multi)([^a-z]|$)/i.test(t)) best.eng = true;

            var res = detectResolution(item);
            if (!res) return;

            if (RES_ORDER.indexOf(res) > RES_ORDER.indexOf(bestRes)) {
                bestRes = res;
                var isDv = t.indexOf('dolby vision') >= 0 || t.indexOf('dolbyvision') >= 0 || /(^|[^a-z])dovi([^a-z]|$)/i.test(t);
                var videoType = String(item && (item.videotype || item.VideoType) || '').toLowerCase();
                best.dolbyVision = isDv;
                best.hdr = isDv || videoType === 'hdr' || /(^|[^a-z])hdr(10)?(\+)?([^a-z]|$)/i.test(t);
            }
        });

        if (!found) return emptyMarksData();
        best.resolution = bestRes || 'SD';
        best.ukr = true;
        best.empty = false;
        return best;
    }

    /* ------------------------------------------------------------------ *
     *  SEARCH PROCESSOR
     * ------------------------------------------------------------------ */

    function buildUrls(host, title, year, apiKey) {
        var encodedTitle = encodeURIComponent(title);
        var list = [];

        // 1. Jackett API (Основний ендпоінт для LampaUA / jackettua.mooo.com)
        var jackettUrl = host + '/api/v2.0/indexers/all/results?apikey=' + encodeURIComponent(apiKey) + '&Query=' + encodedTitle;
        list.push(jackettUrl);

        // 2. JacRed API (Резервний ендпоінт)
        var jacredUrl = host + '/api/v1.0/torrents?search=' + encodedTitle +
                        (year ? '&year=' + encodeURIComponent(year) : '') +
                        '&apikey=' + encodeURIComponent(apiKey) +
                        '&key=' + encodeURIComponent(apiKey) +
                        '&uid=' + encodeURIComponent(apiKey);
        list.push(jacredUrl);

        return list;
    }

    function jacredSearch(movie, callback) {
        var dateRaw = movie.release_date || movie.first_air_date || movie.year || '';
        var yearStr = String(dateRaw).substr(0, 4);
        var yearNum = /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : 0;

        var apiKey = getApiKey();
        var titles = [];
        var loc = (movie.title || movie.name || '').trim();
        var orig = (movie.original_title || movie.original_name || '').trim();

        if (loc && /[a-zа-яєіїґ0-9]/i.test(loc)) titles.push(loc);
        if (orig && orig !== loc && /[a-zа-яєіїґ0-9]/i.test(orig)) titles.push(orig);

        if (!titles.length) return callback(emptyMarksData());

        var hosts = getActiveParserHosts();
        if (!hosts.length) return callback(emptyMarksData());

        var tasks = [];

        for (var h = 0; h < hosts.length; h++) {
            for (var t = 0; t < titles.length; t++) {
                var urls = buildUrls(hosts[h], titles[t], yearNum ? yearStr : '', apiKey);
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

                var data = analyzeTorrents(results, movie, yearNum, task.host);
                if (data && !data.empty) return callback(data);

                runTask(index + 1);
            });
        }

        runTask(0);
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

        jacredSearch(task.movie, finish);
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
        var card = $(cardNode);
        return cardNode.heroMovieData || cardNode.card_data || card.data('item') || cardNode.item || cardNode.data || null;
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
            }, 120);
        }

        var observer = new MutationObserver(scheduleProcess);
        var target = document.getElementById('app') || document.body;
        observer.observe(target, { childList: true, subtree: true });

        processCards();
        setTimeout(processCards, 500);
    }

    function injectStyle() {
        if (document.getElementById('likhtar-marks-style-v6')) return;

        var style = document.createElement('style');
        style.id = 'likhtar-marks-style-v6';
        style.innerHTML = '\
            .likhtar-marks-container {\
                position: absolute;\
                top: 0.6em;\
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

        document.head.appendChild(style);
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
    }

    if (window.appready) runInit();
    else if (Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') runInit(); });
    } else setTimeout(runInit, 1000);
})();