(() => {
  'use strict';

  const BOOK_ID = '1RC-Xw_HcZpVzF8GJ6zXg_EtzuIX6Xcn1aADtLT_jzpk';
  const SHEETS = [
    ['K-POP', '679521476'], ['POP', '1122851619'], ['J-POP', '1006128282'],
    ['Musical', '248105341'], ['Jazz & Bossa', '422984357'], ['숙제', '1374116302']
  ];
  const PAGE_SIZE = 30;
  const state = { songs: [], genre: '전체 장르', artist: '전체 가수', query: '', artistQuery: '', sort: 'artist', page: 1 };
  const $ = (id) => document.getElementById(id);
  const el = {
    sync: $('sync-text'), refresh: $('refresh'), search: $('search'), reset: $('reset'),
    total: $('total-count'), genres: $('genre-options'), artistTotal: $('artist-total'),
    artistSearch: $('artist-search'), artists: $('artist-options'), resultTitle: $('result-title'),
    resultCount: $('result-count'), sort: $('sort'), rows: $('song-rows'), empty: $('empty'),
    range: $('range'), pageLabel: $('page-label'), prev: $('prev'), next: $('next'), results: $('song-list')
  };

  function normalized(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase('ko').replace(/[\s\p{P}\p{S}]/gu, '');
  }

  function loadSheet(genre, gid, attempt) {
    return new Promise((resolve, reject) => {
      const callback = `singgyulSheet${Date.now()}${attempt}`;
      const script = document.createElement('script');
      const timeout = setTimeout(() => finish(new Error('시간 초과')), 15000);
      const finish = (error, value) => {
        clearTimeout(timeout); delete window[callback]; script.remove();
        error ? reject(error) : resolve(value);
      };
      window[callback] = (response) => {
        if (response.status === 'error') return finish(new Error('시트 응답 오류'));
        const songs = response.table.rows.map((row) => {
          const cells = row.c || [];
          const value = (index) => cells[index]?.v == null ? '' : String(cells[index].v).trim();
          return { number: value(0), artist: value(1), title: value(2), original: value(3), memo: value(4), genre };
        }).filter((song) => song.title && song.number);
        finish(null, songs);
      };
      const query = encodeURIComponent('select C,F,M,U,AC');
      script.src = `https://docs.google.com/spreadsheets/d/${BOOK_ID}/gviz/tq?gid=${gid}&tq=${query}&tqx=responseHandler:${callback}`;
      script.onerror = () => finish(new Error('연결 실패'));
      document.head.appendChild(script);
    });
  }

  async function loadSongs() {
    el.results.setAttribute('aria-busy', 'true'); el.refresh.classList.add('spin'); el.refresh.disabled = true;
    el.sync.textContent = '목록 확인 중';
    try {
      const groups = await Promise.all(SHEETS.map(([genre, gid], index) => loadSheet(genre, gid, index)));
      const unique = new Map();
      groups.flat().forEach((song) => {
        const key = normalized(song.artist) + '|' + normalized(song.title);
        if (!unique.has(key)) unique.set(key, song);
        else if (song.genre !== '숙제') unique.set(key, song);
      });
      state.songs = [...unique.values()];
      el.sync.textContent = `목록 확인 · ${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
      render();
    } catch (error) {
      el.sync.textContent = '연결을 확인해 주세요';
      el.rows.innerHTML = '<tr><td colspan="4" class="empty-cell">노래 목록을 불러오지 못했습니다. 새로고침 버튼을 눌러 다시 시도해 주세요.</td></tr>';
    } finally {
      el.results.setAttribute('aria-busy', 'false'); el.refresh.classList.remove('spin'); el.refresh.disabled = false;
    }
  }

  function counts(key) {
    return state.songs.reduce((map, song) => map.set(song[key] || '미분류', (map.get(song[key] || '미분류') || 0) + 1), new Map());
  }

  function option(label, count, active, onClick) {
    const button = document.createElement('button'); button.className = `filter-option${active ? ' active' : ''}`;
    button.type = 'button'; button.setAttribute('aria-pressed', active); button.textContent = label;
    const badge = document.createElement('span'); badge.className = 'count'; badge.textContent = count; button.appendChild(badge);
    button.addEventListener('click', onClick); return button;
  }

  function renderFilters() {
    const genreCounts = counts('genre'); el.genres.replaceChildren();
    el.genres.appendChild(option('전체 장르', state.songs.length, state.genre === '전체 장르', () => { state.genre = '전체 장르'; state.page = 1; render(); }));
    SHEETS.forEach(([genre]) => { if (genreCounts.has(genre)) el.genres.appendChild(option(genre, genreCounts.get(genre), state.genre === genre, () => { state.genre = genre; state.page = 1; render(); })); });

    const artistCounts = counts('artist'); const names = [...artistCounts.keys()].sort((a, b) => a.localeCompare(b, 'ko', { sensitivity: 'base' }));
    el.artistTotal.textContent = names.length; el.artists.replaceChildren();
    el.artists.appendChild(option('전체 가수', state.songs.length, state.artist === '전체 가수', () => { state.artist = '전체 가수'; state.page = 1; render(); }));
    const aq = normalized(state.artistQuery);
    names.filter((name) => normalized(name).includes(aq)).forEach((name) => el.artists.appendChild(option(name || '미상', artistCounts.get(name), state.artist === name, () => { state.artist = name; state.page = 1; render(); })));
  }

  function filteredSongs() {
    const query = normalized(state.query);
    return state.songs.filter((song) => (state.genre === '전체 장르' || song.genre === state.genre) && (state.artist === '전체 가수' || song.artist === state.artist) && (!query || normalized([song.title, song.artist, song.original, song.memo].join(' ')).includes(query))).sort((a, b) => {
      const primary = state.sort === 'title' ? 'title' : state.sort === 'genre' ? 'genre' : 'artist';
      return a[primary].localeCompare(b[primary], 'ko', { numeric: true, sensitivity: 'base' }) || a.title.localeCompare(b.title, 'ko');
    });
  }

  function renderRows(songs, offset) {
    el.rows.replaceChildren();
    songs.forEach((song, index) => {
      const row = document.createElement('tr');
      const number = document.createElement('td'); number.className = 'number-col'; number.textContent = String(offset + index + 1).padStart(2, '0');
      const title = document.createElement('td'); title.className = 'title-cell'; title.append(document.createTextNode(song.title));
      if (song.original && normalized(song.original) !== normalized(song.title)) { const original = document.createElement('small'); original.textContent = ` · ${song.original}`; title.appendChild(original); }
      const mobileArtist = document.createElement('span'); mobileArtist.className = 'mobile-artist'; mobileArtist.textContent = song.artist || '미상'; title.appendChild(mobileArtist);
      const artist = document.createElement('td'); artist.className = 'artist-col'; artist.textContent = song.artist || '미상';
      const genre = document.createElement('td'); genre.className = 'genre-col'; const tag = document.createElement('span'); tag.className = 'genre-tag'; tag.textContent = song.genre; genre.appendChild(tag);
      row.append(number, title, artist, genre); el.rows.appendChild(row);
    });
  }

  function render() {
    renderFilters(); const songs = filteredSongs(); const pages = Math.max(1, Math.ceil(songs.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages); const start = (state.page - 1) * PAGE_SIZE; const visible = songs.slice(start, start + PAGE_SIZE);
    el.total.textContent = state.songs.length; el.resultCount.textContent = songs.length;
    el.resultTitle.textContent = state.query ? '검색 결과' : state.artist !== '전체 가수' ? state.artist : state.genre !== '전체 장르' ? state.genre : '전체 노래';
    renderRows(visible, start); el.empty.hidden = visible.length > 0;
    el.range.textContent = songs.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, songs.length)} / ${songs.length}곡` : '0곡';
    el.pageLabel.textContent = `${state.page} / ${pages}`; el.prev.disabled = state.page <= 1; el.next.disabled = state.page >= pages;
  }

  el.search.addEventListener('input', (event) => { state.query = event.target.value; state.page = 1; render(); });
  el.artistSearch.addEventListener('input', (event) => { state.artistQuery = event.target.value; renderFilters(); });
  el.sort.addEventListener('change', (event) => { state.sort = event.target.value; state.page = 1; render(); });
  el.reset.addEventListener('click', () => { state.genre = '전체 장르'; state.artist = '전체 가수'; state.query = ''; state.artistQuery = ''; state.page = 1; el.search.value = ''; el.artistSearch.value = ''; render(); });
  el.prev.addEventListener('click', () => { if (state.page > 1) { state.page--; render(); el.results.scrollIntoView({ behavior: 'smooth' }); } });
  el.next.addEventListener('click', () => { if (state.page * PAGE_SIZE < filteredSongs().length) { state.page++; render(); el.results.scrollIntoView({ behavior: 'smooth' }); } });
  el.refresh.addEventListener('click', loadSongs);
  loadSongs();
})();
