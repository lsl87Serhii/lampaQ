(function () {
    'use strict';

    if (typeof Lampa === 'undefined') return;

    var LOG = false;
    var CACHE_KEY = 'marks_quality_cache_v16';
    var CACHE_TIME = 12 * 60 * 60 * 1000; // 12 годин
    var REQ_TIMEOUT = 12000;
    var MAX_PARALLEL = 3;
    var RES_ORDER = ['SD', 'HD', 'FHD', '2K', '4K'];

    var memCache = {};
    var pending = {};
    var queue = [];
    var active = 0;

    /* ------------------------------------------------------------------ *
     *  HOST & API KEY RESOLUTION
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

    function getJackettHost() {
        var custom = Lampa.Storage.get('marks_jacred_url', 'auto');
        if (custom && custom !== 'auto') return normalizeHost(custom);

        var keys = ['jackett_url', 'spawnua_url', 'lampaua_url', 'parser_torrent_url', 'jacred_url', 'parser_url'];
        for (var i = 0; i < keys.length; i++) {
            var val = Lampa.Storage.get(keys[i], '');
            if (val) {
                var h = normalizeHost(val);
                if (h) return h;
            }
        }
        if (Lampa.Parser) {
            try {
                var pUrl = typeof Lampa.Parser.url === 'function' ? Lampa.Parser.url() : Lampa.Parser.url;
                if (pUrl) return normalizeHost(pUrl);
            } catch (e) {}
        }
        return 'http://jackettua.mooo.com';
    }

    function getJackettKey() {
        var keys = ['jackett_key', 'spawnua_key', 'parser_key', 'jacred_key'];
        for (var i = 0; i < keys.length; i++) {
            var val = Lampa.Storage.get(keys[i], '');
            if (val !== undefined && val !== null && String(val).trim() !== '') {
                return String(val).trim();
            }
        }
        return 'ua';
    }

    /* ------------------------------------------------------------------ *
     *  SETTINGS & CACHE
     * ------------------------------------------------------------------ */

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
            Lampa.Storage.set(CACHE_KEY, store);
        } catch (e) {}
    }

    function clearCache() {
        memCache = {};
        try { Lampa.Storage.set(CACHE_KEY, {}); } catch (e) {}
    }

    /* ------------------------------------------------------------------ *
     *  NETWORK REQUESTS
     * ------------------------------------------------------------------ */

    function fetchJackett(query, callback) {
        var host = getJackettHost();
        var key = getJackettKey();
        var url = host + '/api/v2.0/indexers/all/results?apikey=' + encodeURIComponent(key) + '&Query=' + encodeURIComponent(query);

        try {
            var req = new Lampa.Reguest();
            req.timeout(REQ_TIMEOUT);
            req.silent(url, function (res) {
                callback(null, res);
            }, function (err) {
                callback(err || new Error('Request failed'));
            });
        } catch (e) {
            callback(e);
        }
    }

    /* ------------------------------------------------------------------ *
     *  TORRENT PARSING & QUALITY MATCHING
     * ------------------------------------------------------------------ */

    function parseResults(res) {
        if (!res) return [];
        if (typeof res === 'string') {
            try { res = JSON.parse(res); } catch (e) { return []; }
        }
        if (Array.isArray(res)) return res;
        if (res.Results && Array.isArray(res.Results)) return res.Results;
        if (res.results && Array.isArray(res.results)) return res.results;
        if (res.items && Array.isArray(res.items)) return res.items;
        if (res.torrents && Array.isArray(res.torrents)) return res.torrents;
        return [];
    }

    function detectResolution(title) {
        var t = String(title || '').toLowerCase();
        if (/(2160|4k|uhd|ultra\s*hd)/i.test(t)) return '4K';
        if (/(1440|2k|qhd)/i.test(t)) return '2K';
        if (/(1080|fhd|full\s*hd)/i.test(t)) return 'FHD';
        if (/(720|hdrip|hdtv)/i.test(t)) return 'HD';
        if (/(480|576|sd|dvdrip)/i.test(t)) return 'SD';
        return 'FHD';
    }

    function extractTorrentYears(title) {
        var years = [];
        var matches = String(title || '').match(/(?:^|[^0-9])(19\d{2}|20\d{2})(?:[^0-9]|$)/g);
        if (matches) {
            matches.forEach(function (m) {
                var y = parseInt(m.replace(/[^0-9]/g, ''), 10);
                if (y >= 1900 && y <= 2030 && years.indexOf(y) === -1) years.push(y);
            });
        }
        return years;
    }

    function analyzeTorrents(items, wantYear) {
        var best = { empty: true, resolution: '', ukr: true, eng: false, hdr: false, dolbyVision: false };
        var bestResIndex = -1;
        var found = false;

        items.forEach(function (item) {
            var title = String(item.Title || item.title || item.name || '');
            if (!title) return;

            if (wantYear) {
                var tYears = extractTorrentYears(title);
                if (tYears.length > 0) {
                    var match = tYears.some(function (y) { return Math.abs(y - wantYear) <= 1; });
                    if (!match) return;
                }
            }

            var tLower = title.toLowerCase();
            if (/(camrip|telesync|\bts\b|\bcam\b|screener)/i.test(tLower)) return;

            found = true;
            if (/(eng|english|multi)/i.test(tLower)) best.eng = true;

            var res = detectResolution(title);
            var resIdx = RES_ORDER.indexOf(res);
            if (resIdx >= bestResIndex) {
                bestResIndex = resIdx;
                best.resolution = res;

                if (tLower.indexOf('dolby vision') >= 0 || tLower.indexOf('dovi') >= 0) {
                    best.dolbyVision = true;
                    best.hdr = true;
                } else if (/(hdr10\+|hdr10|hdr)/i.test(tLower)) {
                    best.hdr = true;
                }
            }
        });

        if (!found) return { empty: true };
        best.empty = false;
        return best;
    }

    /* ------------------------------------------------------------------ *
     *  SEARCH FLOW
     * ------------------------------------------------------------------ */

    function searchMovie(movie, callback) {
        var dateRaw = movie.release_date || movie.first_air_date || movie.year || '';
        var yearStr = String(dateRaw).substr(0, 4);
        var yearNum = /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : 0;

        var locTitle = String(movie.title || movie.name || '').replace(/[!\?\:\–\—\.\,\_\/]/g, ' ').trim();
        var origTitle = String(movie.original_title || movie.original_name || '').replace(/[!\?\:\–\—\.\,\_\/]/g, ' ').trim();

        var queries = [];
        if (locTitle) queries.push(locTitle);
        if (origTitle && origTitle !== locTitle) queries.push(origTitle);

        if (!queries.length) return callback({ empty: true });

        function tryQuery(index) {
            if (index >= queries.length) return callback({ empty: true });

            fetchJackett(queries[index], function (err, res) {
                if (err || !res) return tryQuery(index + 1);

                var items = parseResults(res);
                if (!items.length) return tryQuery(index + 1);

                var data = analyzeTorrents(items, yearNum);
                if (data && !data.empty) return callback(data);

                tryQuery(index + 1);
            });
        }

        tryQuery(0);
    }

    /* ------------------------------------------------------------------ *
     *  QUEUE & CARD PROCESSING
     * ------------------------------------------------------------------ */

    function pump() {
        while (active < MAX_PARALLEL && queue.length) runTask(queue.shift());
    }

    function runTask(task) {
        active++;
        searchMovie(task.movie, function (data) {
            setCache(task.key, data);
            var cbs = pending[task.key] || [];
            delete pending[task.key];
            for (var i = 0; i < cbs.length; i++) {
                try { cbs[i](data); } catch (e) {}
            }
            active--;
            pump();
        });
    }

    function resolveMarks(movie, callback) {
        var id = movie.id || movie.kp_id || movie.imdb_id;
        var type = (movie.media_type || movie.type || ((movie.name || movie.original_name) ? 'tv' : 'movie'));
        var key = type + '_' + id;

        var cached = getCache(key);
        if (cached) return callback(cached);

        if (pending[key]) {
            pending[key].push(callback);
            return;
        }

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

    function createBadge(cssClass, label) {
        var badge = document.createElement('div');
        badge.className = 'likhtar-marks-badge likhtar-marks-badge--' + cssClass;
        badge.textContent = label;
        return badge;
    }

    function renderBadges(container, data, movie, $card) {
        container.empty();
        $card.find('.card__vote, .card__rate, div[class*="card__vote"]').remove();

        if (!isSettingEnabled('marks_enabled', true) || data.empty) return;

        if (data.ukr && isSettingEnabled('marks_ua', true)) container.append(createBadge('ua', 'UA'));
        if (data.eng && isSettingEnabled('marks_en', true)) container.append(createBadge('en', 'EN'));

        if (data.resolution) {
            if (data.resolution === '4K' && isSettingEnabled('marks_4k', true)) {
                container.append(createBadge('4k', '4K'));
            } else if (data.resolution === '2K' && isSettingEnabled('marks_fhd', true)) {
                container.append(createBadge('fhd', '2K'));
            } else if (data.resolution === 'FHD' && isSettingEnabled('marks_fhd', true)) {
                container.append(createBadge('fhd', '1080p'));
            } else if (data.resolution === 'HD' && isSettingEnabled('marks_fhd', true)) {
                container.append(createBadge('hd', '720p'));
            }
        }

        if (data.hdr && isSettingEnabled('marks_hdr', true)) {
            container.append(createBadge('hdr', data.dolbyVision ? 'DV' : 'HDR'));
        }

        if (isSettingEnabled('marks_rating', true)) {
            var rating = parseFloat(movie.imdb_rating || movie.vote_average || movie.rating || 0);
            if (rating > 0) {
                var rBadge = document.createElement('div');
                rBadge.className = 'likhtar-marks-badge likhtar-marks-badge--rating';
                rBadge.innerHTML = '<span class="likhtar-marks-star">&#9733;</span>' + rating.toFixed(1);
                container.append(rBadge);
            }
        }

        if (isSettingEnabled('marks_year', true)) {
            var rawYear = movie.release_date || movie.first_air_date || movie.year || '';
            var yearStr = String(rawYear).substr(0, 4);
            if (/^\d{4}$/.test(yearStr)) {
                container.append(createBadge('year', yearStr));
            }
        }
    }

    function processCards() {
        if (!isSettingEnabled('marks_enabled', true)) return;

        $('.card').each(function () {
            var $card = $(this);
            $card.find('.card__vote, .card__rate, div[class*="card__vote"]').remove();

            if ($card.hasClass('likhtar-marks-processed')) return;

            var movie = getMovieFromCard(this);
            if (!movie || (!movie.id && !movie.kp_id && !movie.imdb_id)) return;

            $card.addClass('likhtar-marks-processed');

            var containerParent = $card.hasClass('hero-banner') ? $card : ($card.find('.card__view').first().length ? $card.find('.card__view').first() : $card);
            if (containerParent.css('position') === 'static') containerParent.css('position', 'relative');

            var marksContainer = containerParent.find('.likhtar-marks-container').first();
            if (!marksContainer.length) {
                marksContainer = $('<div class="likhtar-marks-container"></div>');
                containerParent.append(marksContainer);
            }

            resolveMarks(movie, function (data) {
                if (!document.body.contains($card[0])) return;
                renderBadges(marksContainer, data, movie, $card);
            });
        });
    }

    /* ------------------------------------------------------------------ *
     *  STYLES & SETUP
     * ------------------------------------------------------------------ */

    function injectStyle() {
        if (document.getElementById('likhtar-marks-style-v16')) return;
        var style = document.createElement('style');
        style.id = 'likhtar-marks-style-v16';
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
        ';
        (document.head || document.documentElement).appendChild(style);
    }

    function setupSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;
        if (window.marks_quality_settings_added) return;
        window.marks_quality_settings_added = true;

        var component = 'interface';
        Lampa.SettingsApi.addParam({ component: component, param: { type: 'title' }, field: { name: 'Мітки якості (Marks)' } });
        Lampa.SettingsApi.addParam({ component: component, param: { name: 'marks_enabled', type: 'trigger', default: true }, field: { name: 'Увімкнути модуль міток' }, onChange: function () { setTimeout(processCards, 50); } });
        Lampa.SettingsApi.addParam({ component: component, param: { name: 'marks_ua', type: 'trigger', default: true }, field: { name: 'Показувати мітку UA' }, onChange: function () { setTimeout(processCards, 50); } });
        Lampa.SettingsApi.addParam({ component: component, param: { name: 'marks_4k', type: 'trigger', default: true }, field: { name: 'Показувати мітку 4K' }, onChange: function () { setTimeout(processCards, 50); } });
        Lampa.SettingsApi.addParam({ component: component, param: { name: 'marks_fhd', type: 'trigger', default: true }, field: { name: 'Показувати мітки 1080p / 720p' }, onChange: function () { setTimeout(processCards, 50); } });
        Lampa.SettingsApi.addParam({ component: component, param: { name: 'marks_rating', type: 'trigger', default: true }, field: { name: 'Показувати мітку рейтингу' }, onChange: function () { setTimeout(processCards, 50); } });
        Lampa.SettingsApi.addParam({ component: component, param: { name: 'marks_cache_clear', type: 'button' }, field: { name: 'Очистити кеш міток', description: 'Скинути збережені дані про якість' }, onChange: function () { clearCache(); if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Кеш очищено'); refreshAllMarks(); } });
    }

    function refreshAllMarks() {
        $('.likhtar-marks-container').remove();
        $('.card').removeClass('likhtar-marks-processed');
        processCards();
    }

    function runInit() {
        setupSettings();
        clearCache();
        injectStyle();
        processCards();
        setInterval(processCards, 1000);

        var observer = new MutationObserver(function () { processCards(); });
        var target = document.getElementById('app') || document.body;
        if (target) observer.observe(target, { childList: true, subtree: true });
    }

    if (window.appready) runInit();
    else if (Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') runInit(); });
    } else setTimeout(runInit, 1000);
})();