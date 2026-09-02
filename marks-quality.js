(function () {
    'use strict';

    if (window.marks_quality_merged_v2) return;
    window.marks_quality_merged_v2 = true;

    if (typeof Lampa === 'undefined') {
        console.warn('Marks+Quality: Lampa not found');
        return;
    }

    /* ------------------------------------------------------------------ *
     *  CONFIG
     * ------------------------------------------------------------------ */

    var LOG = false;
    var DEFAULT_JACRED = 'jr.maxvol.pro';
    var CACHE_KEY = 'marks_quality_cache_v2';
    var CACHE_TIME = 24 * 60 * 60 * 1000;              // 24 години
    var CACHE_LIMIT = 800;                             // Максимум записів у кеші
    var REQ_TIMEOUT = 6000;                            // Таймаут запиту (мс)
    var MAX_PARALLEL = 3;                              // Паралельні запити
    var RES_ORDER = ['SD', 'HD', 'FHD', '2K', '4K'];

    // Джерела та теги для ідентифікації українського контенту
    var UA_TRACKERS = ['toloka', 'toloka.to', 'mazepa', 'hurtom', 'uafilm', 'baibako', 'ua-tracker', 'mova'];

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
            if (t === 'false' || t === '0' || t === 'off' || t === 'no' || t === 'none' || t === 'disabled') return false;
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
     *  NETWORK (Lampa.Reguest)
     * ------------------------------------------------------------------ */

    function fetchUrl(url, callback) {
        try {
            var network = new Lampa.Reguest();
            network.timeout(REQ_TIMEOUT);
            network.silent(url, function (res) {
                if (typeof res === 'object') {
                    callback(null, JSON.stringify(res));
                } else if (typeof res === 'string') {
                    callback(null, res);
                } else {
                    callback(new Error('Empty response'));
                }
            }, function (err) {
                callback(err || new Error('Request failed'));
            });
        } catch (e) {
            callback(e);
        }
    }

    /* ------------------------------------------------------------------ *
     *  DATA MODEL & PARSING
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

    function isUaRelease(item) {
        if (!item) return false;

        // 1. Перевірка імені трекера чи URL
        var fields = [item.trackerName, item.tracker, item.Tracker, item.url, item.Details];
        for (var i = 0; i < fields.length; i++) {
            var v = String(fields[i] || '').toLowerCase();
            if (!v) continue;
            for (var j = 0; j < UA_TRACKERS.length; j++) {
                if (v.indexOf(UA_TRACKERS[j]) >= 0) return true;
            }
        }

        // 2. Аналіз назви на наявність позначок українського перекладу/озвучки
        var t = String(item.title || '').toLowerCase();
        if (/(^|[\s\.\_\-\[\(\/])(ukr|ua|ukrainian|укр|українськ|украинск)([\s\.\_\-\]\)\/]|$)/i.test(t)) {
            return true;
        }

        return false;
    }

    function detectResolution(item) {
        var t = String(item && item.title || '').toLowerCase();

        // Межі слів з урахуванням кирилиці
        var b = '(?:^|[^a-z0-9а-яіїєґ])';
        var e = '(?:[^a-z0-9а-яіїєґ]|$)';

        if (new RegExp(b + '(2160[pi]?|4k|uhd)' + e, 'i').test(t)) return '4K';
        if (new RegExp(b + '(1440[pi]?|2k)' + e, 'i').test(t)) return '2K';
        if (new RegExp(b + '(1080[pi]?|fhd|full ?hd)' + e, 'i').test(t)) return 'FHD';
        if (new RegExp(b + '(720[pi]?|hdrip|hdtv)' + e, 'i').test(t)) return 'HD';
        if (new RegExp(b + '(480[pi]?|360[pi]?|sd|dvdrip|vhsrip|dvdscr)' + e, 'i').test(t)) return 'SD';

        var q = parseInt(item && item.quality, 10) || 0;
        if (q >= 2160) return '4K';
        if (q >= 1440) return '2K';
        if (q >= 1080) return 'FHD';
        if (q >= 720) return 'HD';
        if (q > 0) return 'SD';

        return '';
    }

    function releaseYear(item) {
        var direct = parseInt(item && (item.relased || item.released || item.year), 10);
        if (direct >= 1900) return direct;
        var m = String(item && item.title || '').match(/(^|[^0-9])(19|20)(\d{2})([^0-9]|$)/);
        if (m) return parseInt(m[2] + m[3], 10);
        return 0;
    }

    function analyzeTorrents(results, movie, wantYear) {
        var best = emptyMarksData();
        var bestRes = '';
        var found = false;

        results.forEach(function (item) {
            if (!isUaRelease(item)) return;

            if (wantYear) {
                var ry = releaseYear(item);
                if (ry && Math.abs(ry - wantYear) > 1) return;
            }

            var t = String(item && item.title || '').toLowerCase();

            // Ігноруємо екранки
            if (/(^|[^a-zа-яіїєґ])(ts|telesync|camrip|cam|tc|telecine|screener)([^a-zа-яіїєґ]|$)/i.test(t)) return;

            found = true;

            if (/(^|[^a-z])(eng|english|multi)([^a-z]|$)/i.test(t)) best.eng = true;

            var res = detectResolution(item);
            if (!res) return;

            if (RES_ORDER.indexOf(res) > RES_ORDER.indexOf(bestRes)) {
                bestRes = res;

                var isDv = t.indexOf('dolby vision') >= 0 || t.indexOf('dolbyvision') >= 0 || /(^|[^a-z])dovi([^a-z]|$)/i.test(t);
                var videoType = String(item && item.videotype || '').toLowerCase();
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
     *  JACRED SEARCH
     * ------------------------------------------------------------------ */

    function buildJacredUrl(host, title, year, uid) {
        var url = host + '/api/v1.0/torrents?search=' + encodeURIComponent(title);
        if (year) url += '&year=' + encodeURIComponent(year);
        if (uid) url += '&uid=' + encodeURIComponent(uid);
        return url;
    }

    function jacredSearch(movie, callback) {
        var dateRaw = movie.release_date || movie.first_air_date || movie.year || '';
        var yearStr = String(dateRaw).substr(0, 4);
        var yearNum = /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : 0;

        var uid = Lampa.Storage.get('lampac_unic_id', '');
        var titles = [];
        var orig = (movie.original_title || movie.original_name || '').trim();
        var loc = (movie.title || movie.name || '').trim();

        if (orig && /[a-zа-яєіїґ0-9]/i.test(orig)) titles.push(orig);
        if (loc && loc !== orig && /[a-zа-яєіїґ0-9]/i.test(loc)) titles.push(loc);

        if (!titles.length) return callback(emptyMarksData());

        var hosts = jacredHosts();
        var tasks = [];

        for (var h = 0; h < hosts.length; h++) {
            for (var t = 0; t < titles.length; t++) {
                if (yearNum) {
                    tasks.push({ host: hosts[h], title: titles[t], year: yearStr });
                }
                tasks.push({ host: hosts[h], title: titles[t], year: '' });
            }
        }

        function runTask(index) {
            if (index >= tasks.length) return callback(emptyMarksData());

            var task = tasks[index];
            var url = buildJacredUrl(task.host, task.title, task.year, uid);

            log('request', movie.id, url);

            fetchUrl(url, function (err, body) {
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

    /* ------------------------------------------------------------------ *
     *  UAFIX FALLBACK
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
            network.timeout(4000);
            network.silent(url, function (json) {
                callback(Boolean(json && json.ok && json.items && json.items.length > 0));
            }, function () { callback(null); });
        } catch (e) { callback(null); }
    }

    function checkUafix(movie, callback) {
        if (!isSettingEnabled('marks_uafix', false)) return callback(false);
        checkUafixBandera(movie, function (result) {
            callback(Boolean(result));
        });
    }

    /* ------------------------------------------------------------------ *
     *  RESOLVE & QUEUE
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

    /* ------------------------------------------------------------------ *
     *  RENDER
     * ------------------------------------------------------------------ */

    function getMovieFromCard(cardNode) {
        if (!cardNode) return null;
        var card = $(cardNode);
        return cardNode.heroMovieData ||
               cardNode.card_data ||
               card.data('item') ||
               cardNode.item ||
               cardNode.data ||
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
        if (!movie || !renderEl) return;

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
            }, 120);
        }

        var observer = new MutationObserver(scheduleProcess);
        var target = document.getElementById('app') || document.body;
        observer.observe(target, { childList: true, subtree: true });

        processCards();
        setTimeout(processCards, 500);
    }

    function initFullCardObserver() {
        if (!Lampa.Listener || !Lampa.Listener.follow) return;

        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;
            var movie = e.data && e.data.movie;
            var renderEl = e.object && e.object.activity && e.object.activity.render && e.object.activity.render();
            injectFullCardMarks(movie, renderEl);
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
            field: { name: 'Мітки якості та перекладу' }
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
            param: { name: 'marks_cache_clear', type: 'button' },
            field: { name: 'Очистити кеш міток', description: 'Скинути сохранені дані про якість' },
            onChange: function () {
                clearCache();
                if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Кеш очищено');
                refreshAllMarks();
            }
        });
    }

    function injectStyle() {
        if (document.getElementById('likhtar-marks-style-v2')) return;

        var style = document.createElement('style');
        style.id = 'likhtar-marks-style-v2';
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
            .likhtar-marks-full {\
                position: absolute;\
                top: 0.8em;\
                right: 0.4em;\
                display: flex;\
                flex-direction: column;\
                gap: 0.3em;\
                z-index: 20;\
            }\
            .likhtar-marks-full-badge {\
                padding: 0.3em 0.5em;\
                border-radius: 0.3em;\
                font-size: 0.8em;\
                font-weight: 800;\
                color: #fff;\
                box-shadow: 0 2px 6px rgba(0,0,0,0.4);\
            }\
            .likhtar-marks-full-badge--ua { background: linear-gradient(135deg, #1565c0, #42a5f5); }\
            .likhtar-marks-full-badge--quality { background: linear-gradient(135deg, #2e7d32, #66bb6a); }\
            .likhtar-marks-full-badge--hdr { background: linear-gradient(135deg, #512da8, #ab47bc); }\
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
        setTimeout(refreshAllMarks, 100);
    }

    if (window.appready) runInit();
    else if (Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') runInit(); });
    } else setTimeout(runInit, 1000);
})();