(function () {
    'use strict';

    function initNetflixCarousel() {
        if (window.netflix_carousel_injected) return;
        window.netflix_carousel_injected = true;

        var style = document.createElement('style');
        style.type = 'text/css';
        style.id = 'lampa-netflix-carousel-style';
        style.innerHTML = `
            /* Контейнер ряду каруселі */
            .items__body, .category-full__body {
                display: flex !important;
                align-items: center !important;
                gap: 12px !important;
                padding: 15px 0 !important;
                overflow-x: visible !important;
            }

            /* Неактивні картки (Вертикальні) */
            .card {
                width: 140px !important;
                height: 210px !important;
                flex-shrink: 0 !important;
                transition: width 0.35s cubic-bezier(0.25, 1, 0.5, 1), 
                            transform 0.35s cubic-bezier(0.25, 1, 0.5, 1), 
                            box-shadow 0.35s ease !important;
                border-radius: 6px !important;
                overflow: hidden !important;
            }

            .card .card__view {
                width: 100% !important;
                height: 100% !important;
                border-radius: 6px !important;
            }

            .card .card__img {
                object-fit: cover !important;
                width: 100% !important;
                height: 100% !important;
            }

            /* Активна картка (Трансформація в Горизонтальну) */
            .card.focus {
                width: 320px !important; /* Розширюємо в горизонтальний банер */
                z-index: 50 !important;
                box-shadow: 0 10px 30px rgba(0,0,0,0.9), 0 0 0 2px #ffffff !important;
                transform: scale(1.04) !important;
            }

            /* Інформаційний блок під рядочком */
            .nf-carousel-info {
                padding: 10px 20px 20px 20px;
                color: #ffffff;
                animation: fadeIn 0.2s ease-in-out;
            }

            .nf-carousel-info .nf-meta {
                font-size: 14px;
                font-weight: 600;
                color: #e5e5e5;
                margin-bottom: 6px;
                display: flex;
                gap: 8px;
            }

            .nf-carousel-info .nf-badge {
                color: #46d369;
                font-weight: bold;
            }

            .nf-carousel-info .nf-desc {
                font-size: 13px;
                color: #aaaaaa;
                line-height: 1.4;
                max-width: 800px;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(-4px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);

        // Відстеження фокусу для заміни постера на широкий кадр і виводу опису
        Lampa.Listener.follow('card', function (e) {
            if (e.type === 'focus') {
                var cardElem = e.target;
                var data = e.data || {};

                // Якщо TMDB має backdrop (горизонтальний кадр), підставляємо його при фокусі
                if (data.backdrop_path || data.background) {
                    var imgElem = cardElem.querySelector('.card__img');
                    if (imgElem && !cardElem.dataset.originalSrc) {
                        cardElem.dataset.originalSrc = imgElem.src;
                        var wideUrl = Lampa.TMDB ? Lampa.TMDB.image('backdrop', data.backdrop_path, 'w500') : (data.background || imgElem.src);
                        imgElem.src = wideUrl;
                    }
                }

                updateInfoBlock(cardElem, data);
            }

            if (e.type === 'blur') {
                var cardElem = e.target;
                // Повертаємо вертикальний постер при втраті фокусу
                if (cardElem && cardElem.dataset.originalSrc) {
                    var imgElem = cardElem.querySelector('.card__img');
                    if (imgElem) imgElem.src = cardElem.dataset.originalSrc;
                    delete cardElem.dataset.originalSrc;
                }
            }
        });
    }

    function updateInfoBlock(cardElem, data) {
        var row = cardElem.closest('.items__body') || cardElem.closest('.category-full__body');
        if (!row) return;

        var infoBlock = row.nextElementSibling;
        if (!infoBlock || !infoBlock.classList.contains('nf-carousel-info')) {
            infoBlock = document.createElement('div');
            infoBlock.className = 'nf-carousel-info';
            row.parentNode.insertBefore(infoBlock, row.nextSibling);
        }

        var type = data.name ? 'Серіал' : 'Фільм';
        var year = (data.release_date || data.first_air_date || '').substring(0, 4);
        var vote = data.vote_average ? `★ ${data.vote_average.toFixed(1)}` : '';
        var overview = data.overview || 'Опис доступний при перегляді деталей.';

        infoBlock.innerHTML = `
            <div class="nf-meta">
                <span>${type}</span>
                ${year ? `• <span>${year}</span>` : ''}
                ${vote ? `• <span class="nf-badge">${vote}</span>` : ''}
            </div>
            <div class="nf-desc">${overview}</div>
        `;
    }

    if (window.appready) {
        initNetflixCarousel();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                initNetflixCarousel();
            }
        });
    }
})();