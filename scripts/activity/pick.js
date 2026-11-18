// pick.js — the Discord Activity's game picker (activity/index.html): each game's link keeps
// Discord's query (frame_id, instance_id…), which the Embedded App SDK needs on the next page.
document.querySelectorAll('a[data-game]').forEach((a) => { a.href = `${a.getAttribute('href')}${location.search}`; });
