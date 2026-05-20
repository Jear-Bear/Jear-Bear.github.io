// Blog page — fetches markdown blog posts from GitHub /Blogs/ folder
// Preserves existing architecture: folder per post, blog.md inside has
// line 1 = category, line 2 = description, line 3 = date, line 4+ = body

(function() {
  const list = document.getElementById('post-list');
  const modal = document.getElementById('post-modal');
  const modalClose = document.getElementById('post-modal-close');
  const modalCategory = document.getElementById('post-modal-category');
  const modalDate = document.getElementById('post-modal-date');
  const modalTitle = document.getElementById('post-modal-title');
  const modalBody = document.getElementById('post-modal-body');

  if (!list) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -30px 0px' }
  );

  // Category → CSS class mapping (preserves existing colors)
  function categoryClass(category) {
    const c = (category || '').trim().toLowerCase();
    if (c === 'technology' || c === 'tech') return 'tech';
    if (c === 'language') return 'language';
    if (c === 'food') return 'food';
    if (c === 'travel') return 'travel';
    return 'default';
  }

  function categoryColors(category) {
    const c = categoryClass(category);
    const map = {
      tech:     { bg: '#ebb2b2', fg: '#631d20' },
      language: { bg: '#b2d4eb', fg: '#2e4b8f' },
      food:     { bg: '#d7b2eb', fg: '#722e8f' },
      travel:   { bg: '#b2ebc1', fg: '#25631d' },
      default:  { bg: '#cccccc', fg: '#333333' },
    };
    return map[c] || map.default;
  }

  async function fetchPostFolders() {
    try {
      const res = await fetch(
        'https://api.github.com/repos/Jear-Bear/Jear-Bear.github.io/contents/Blogs'
      );
      if (!res.ok) throw new Error('GitHub API failed');
      const data = await res.json();
      return data
        .filter((item) => item.name !== '.DS_Store')
        .map((item) => item.name);
    } catch (err) {
      console.error('Failed to fetch blog folders:', err);
      return [];
    }
  }

  async function fetchPostMeta(folder) {
    try {
      const res = await fetch(`/Blogs/${folder}/blog.md`);
      if (!res.ok) throw new Error('blog.md missing');
      const text = await res.text();
      const lines = text.split('\n');
      const category = (lines[0] || '').trim();
      const description = (lines[1] || '').trim();
      const date = (lines[2] || '').trim();
      const body = lines.slice(3).join('\n').trim();
      const wordCount = body.split(/\s+/).filter(Boolean).length;
      const readTime = Math.max(1, Math.ceil(wordCount / 200));
      return { folder, category, description, date, body, readTime };
    } catch (err) {
      console.error(`Failed to fetch ${folder}:`, err);
      return null;
    }
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toISOString().slice(0, 10);  // YYYY-MM-DD
  }

  function buildPostItem(meta) {
    const item = document.createElement('article');
    item.className = 'post-item';

    const colors = categoryColors(meta.category);

    const metaCol = document.createElement('div');
    metaCol.className = 'post-meta';

    const date = document.createElement('span');
    date.className = 'post-date';
    date.textContent = formatDate(meta.date);
    metaCol.appendChild(date);

    const cat = document.createElement('span');
    cat.className = `post-category-tag ${categoryClass(meta.category)}`;
    cat.style.background = colors.bg;
    cat.style.color = colors.fg;
    cat.textContent = meta.category || 'Misc';
    metaCol.appendChild(cat);

    const content = document.createElement('div');
    content.className = 'post-content';

    const title = document.createElement('h3');
    title.className = 'post-title';
    title.textContent = meta.folder;
    content.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'post-desc';
    desc.textContent = meta.description;
    content.appendChild(desc);

    const time = document.createElement('span');
    time.className = 'post-time';
    time.textContent = `${meta.readTime} min read`;

    item.appendChild(metaCol);
    item.appendChild(content);
    item.appendChild(time);

    item.addEventListener('click', () => openPost(meta));
    return item;
  }

  function openPost(meta) {
    const colors = categoryColors(meta.category);
    modalCategory.textContent = meta.category || 'Misc';
    modalCategory.style.background = colors.bg;
    modalCategory.style.color = colors.fg;
    modalDate.textContent = formatDate(meta.date);
    modalTitle.textContent = meta.folder;

    // Render markdown
    if (typeof marked !== 'undefined') {
      modalBody.innerHTML = marked.parse(meta.body);
    } else {
      modalBody.textContent = meta.body;
    }

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closePost() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  modalClose.addEventListener('click', closePost);
  modal.addEventListener('click', (e) => {
    if (e.target.classList.contains('post-modal-backdrop')) closePost();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closePost();
  });

  // Main: fetch all folders, then their metas, sort by date desc, render
  fetchPostFolders().then(async (folders) => {
    const metas = await Promise.all(folders.map(fetchPostMeta));
    const valid = metas.filter(Boolean);
    valid.sort((a, b) => new Date(b.date) - new Date(a.date));

    list.innerHTML = '';

    if (!valid.length) {
      const empty = document.createElement('div');
      empty.className = 'post-loading';
      empty.textContent = 'No posts yet. Check back soon.';
      list.appendChild(empty);
      return;
    }

    valid.forEach((meta) => {
      const item = buildPostItem(meta);
      list.appendChild(item);
      observer.observe(item);
    });
  });
})();
