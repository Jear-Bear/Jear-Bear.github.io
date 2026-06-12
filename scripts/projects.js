// Projects page — loads project tiles from GitHub /Project_Showcase/
// Preserves the existing architecture: folder name = project name, with image.png + description.txt inside.

(function() {
  const grid = document.getElementById('projects-grid');
  if (!grid) return;

  // Show a loading placeholder while we fetch
  const loading = document.createElement('div');
  loading.className = 'projects-grid-loading';
  loading.textContent = 'loading projects…';
  grid.appendChild(loading);

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );

  async function fetchProjects() {
    try {
      const url = 'https://api.github.com/repos/Jear-Bear/Jear-Bear.github.io/contents/Project_Showcase';
      const res = await fetch(url);
      if (!res.ok) throw new Error('GitHub API failed');
      const data = await res.json();
      return data
        .filter((item) => item.name !== '.DS_Store')
        .map((item) => item.name);
    } catch (err) {
      console.error('Failed to load projects:', err);
      return [];
    }
  }

  fetchProjects().then(async (folders) => {
    loading.remove();

    if (!folders.length) {
      const empty = document.createElement('div');
      empty.className = 'projects-grid-loading';
      empty.textContent = 'Nothing here yet. Check back soon.';
      grid.appendChild(empty);
      return;
    }

    for (const folder of folders) {
      const tile = document.createElement('article');
      tile.className = 'project-tile';

      const img = document.createElement('img');
      img.src = `../Project_Showcase/${folder}/image.png`;
      img.alt = folder;
      img.loading = 'lazy';
      tile.appendChild(img);

      const content = document.createElement('div');
      content.className = 'project-tile-content';

      const title = document.createElement('h3');
      title.textContent = folder;
      content.appendChild(title);

      const desc = document.createElement('p');
      desc.textContent = '';
      content.appendChild(desc);

      tile.appendChild(content);
      grid.appendChild(tile);

      observer.observe(tile);

      // Fetch description in parallel
      fetch(`../Project_Showcase/${folder}/description.txt`)
        .then((res) => (res.ok ? res.text() : ''))
        .then((text) => { desc.textContent = text.trim(); })
        .catch(() => { desc.textContent = ''; });
    }
  });
})();
