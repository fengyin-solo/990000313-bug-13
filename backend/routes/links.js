const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/links - List links with pagination, filtering, search
router.get('/', (req, res) => {
  const { category, tag, search } = req.query;
  const userId = req.userId;

  // Validate pagination so count and list queries always use the same criteria
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const offset = (page - 1) * limit;

  const db = getDb();

  let whereConditions = ['l.user_id = ?'];
  let params = [userId];

  if (category) {
    whereConditions.push('l.category_id = ?');
    params.push(category);
  }

  // Normalize the keyword once: trim + case-insensitive, and escape LIKE
  // wildcards so "50%" or "a_b" match literally instead of acting as patterns
  const keyword = typeof search === 'string' ? search.trim().toLowerCase() : '';
  if (keyword) {
    const escaped = keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const searchPattern = `%${escaped}%`;
    whereConditions.push(
      "(LOWER(l.title) LIKE ? ESCAPE '\\' OR LOWER(l.description) LIKE ? ESCAPE '\\' OR LOWER(l.url) LIKE ? ESCAPE '\\')"
    );
    params.push(searchPattern, searchPattern, searchPattern);
  }

  let joinClause = '';
  if (tag) {
    joinClause = 'INNER JOIN link_tags lt ON l.id = lt.link_id';
    whereConditions.push('lt.tag = ?');
    params.push(tag);
  }

  const whereClause = whereConditions.join(' AND ');

  // Get total count (same WHERE as the list query)
  const countSql = `SELECT COUNT(DISTINCT l.id) as total FROM links l ${joinClause} WHERE ${whereClause}`;
  const { total } = db.prepare(countSql).get(...params);

  // Get links. created_at ties (bulk imports share a timestamp) fall back to
  // id so pagination order is deterministic and stable across requests.
  const sql = `
    SELECT DISTINCT l.*, c.name as category_name, c.color as category_color
    FROM links l
    LEFT JOIN categories c ON l.category_id = c.id
    ${joinClause}
    WHERE ${whereClause}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ? OFFSET ?
  `;
  const links = db.prepare(sql).all(...params, limit, offset);

  // Get tags for each link
  const getTagsStmt = db.prepare('SELECT tag FROM link_tags WHERE link_id = ?');
  const linksWithTags = links.map((link) => ({
    ...link,
    tags: getTagsStmt.all(link.id).map((t) => t.tag),
  }));

  res.json({
    links: linksWithTags,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

// POST /api/links - Create a new link
router.post('/', (req, res) => {
  const { url, title, description, category_id, tags, is_read_later, review_date } = req.body;
  const userId = req.userId;

  if (!url || !title) {
    return res.status(400).json({ error: 'URL and title are required' });
  }

  const db = getDb();

  const result = db.prepare(
    'INSERT INTO links (user_id, url, title, description, category_id, status, is_read_later, review_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, url, title, description || '', category_id || null, 'unchecked', is_read_later ? 1 : 0, review_date || null);

  const linkId = result.lastInsertRowid;

  // Insert tags
  if (tags && tags.length > 0) {
    const insertTag = db.prepare('INSERT INTO link_tags (link_id, tag) VALUES (?, ?)');
    const insertTags = db.transaction((tagList) => {
      tagList.forEach((tag) => {
        if (tag.trim()) {
          insertTag.run(linkId, tag.trim());
        }
      });
    });
    insertTags(tags);
  }

  // Fetch the created link with all data
  const link = db.prepare(`
    SELECT l.*, c.name as category_name, c.color as category_color
    FROM links l
    LEFT JOIN categories c ON l.category_id = c.id
    WHERE l.id = ?
  `).get(linkId);

  const linkTags = db.prepare('SELECT tag FROM link_tags WHERE link_id = ?').all(linkId);

  res.json({
    ...link,
    tags: linkTags.map((t) => t.tag),
  });
});

// GET /api/links/read-later - Get read later list with filtering
// NOTE: This must come BEFORE /:id routes to avoid being matched as an id
router.get('/read-later', (req, res) => {
  const { status = 'pending' } = req.query;
  const userId = req.userId;

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const offset = (page - 1) * limit;

  const db = getDb();

  const validStatuses = ['pending', 'completed', 'skipped', 'all'];
  const filterStatus = validStatuses.includes(status) ? status : 'pending';

  let whereConditions = ['l.user_id = ?', 'l.is_read_later = 1'];
  let params = [userId];

  if (filterStatus !== 'all') {
    whereConditions.push('l.review_status = ?');
    params.push(filterStatus);
  }

  const whereClause = whereConditions.join(' AND ');

  // Get total count
  const countSql = `SELECT COUNT(*) as total FROM links l WHERE ${whereClause}`;
  const { total } = db.prepare(countSql).get(...params);

  // Get read later links
  const sql = `
    SELECT l.*, c.name as category_name, c.color as category_color
    FROM links l
    LEFT JOIN categories c ON l.category_id = c.id
    WHERE ${whereClause}
    ORDER BY
      CASE l.review_status
        WHEN 'pending' THEN 1
        WHEN 'completed' THEN 2
        ELSE 3
      END,
      l.review_date IS NULL,
      l.review_date ASC,
      l.created_at DESC,
      l.id DESC
    LIMIT ? OFFSET ?
  `;
  const links = db.prepare(sql).all(...params, limit, offset);

  // Get tags for each link
  const getTagsStmt = db.prepare('SELECT tag FROM link_tags WHERE link_id = ?');
  const linksWithTags = links.map((link) => ({
    ...link,
    tags: getTagsStmt.all(link.id).map((t) => t.tag),
  }));

  // Get statistics
  const statsSql = `
    SELECT 
      review_status,
      COUNT(*) as count
    FROM links
    WHERE user_id = ? AND is_read_later = 1
    GROUP BY review_status
  `;
  const statsResult = db.prepare(statsSql).all(userId);
  const stats = {
    pending: 0,
    completed: 0,
    skipped: 0,
    total: 0
  };
  statsResult.forEach(s => {
    stats[s.review_status] = s.count;
    stats.total += s.count;
  });

  res.json({
    links: linksWithTags,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    stats
  });
});

// POST /api/links/:id/read-later - Add link to read later
router.post('/:id/read-later', (req, res) => {
  const { id } = req.params;
  const { review_date } = req.body;
  const userId = req.userId;

  const db = getDb();

  // Verify ownership
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(id, userId);
  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }

  db.prepare(`
    UPDATE links
    SET is_read_later = 1, review_date = ?, review_status = 'pending'
    WHERE id = ?
  `).run(review_date || null, id);

  // Fetch updated link
  const updatedLink = db.prepare(`
    SELECT l.*, c.name as category_name, c.color as category_color
    FROM links l
    LEFT JOIN categories c ON l.category_id = c.id
    WHERE l.id = ?
  `).get(id);

  const linkTags = db.prepare('SELECT tag FROM link_tags WHERE link_id = ?').all(id);

  res.json({
    ...updatedLink,
    tags: linkTags.map((t) => t.tag),
  });
});

// DELETE /api/links/:id/read-later - Remove link from read later
router.delete('/:id/read-later', (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  const db = getDb();

  // Verify ownership
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(id, userId);
  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }

  db.prepare(`
    UPDATE links
    SET is_read_later = 0, review_date = NULL, review_status = 'pending'
    WHERE id = ?
  `).run(id);

  res.json({ message: 'Removed from read later list' });
});

// PUT /api/links/:id/review-status - Update review status
router.put('/:id/review-status', (req, res) => {
  const { id } = req.params;
  const { review_status } = req.body;
  const userId = req.userId;

  const db = getDb();

  // Verify ownership
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(id, userId);
  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }

  const validStatuses = ['pending', 'completed', 'skipped'];
  if (!validStatuses.includes(review_status)) {
    return res.status(400).json({ error: 'Invalid review status' });
  }

  db.prepare(`
    UPDATE links
    SET review_status = ?
    WHERE id = ?
  `).run(review_status, id);

  // Fetch updated link
  const updatedLink = db.prepare(`
    SELECT l.*, c.name as category_name, c.color as category_color
    FROM links l
    LEFT JOIN categories c ON l.category_id = c.id
    WHERE l.id = ?
  `).get(id);

  const linkTags = db.prepare('SELECT tag FROM link_tags WHERE link_id = ?').all(id);

  res.json({
    ...updatedLink,
    tags: linkTags.map((t) => t.tag),
  });
});

// PUT /api/links/:id - Update a link
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { url, title, description, category_id, tags, is_read_later, review_date, review_status } = req.body;
  const userId = req.userId;

  const db = getDb();

  // Verify ownership
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(id, userId);
  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }

  // Update link
  db.prepare(`
    UPDATE links
    SET url = ?, title = ?, description = ?, category_id = ?, is_read_later = ?, review_date = ?, review_status = ?
    WHERE id = ?
  `).run(
    url || link.url, 
    title || link.title, 
    description ?? link.description, 
    category_id ?? link.category_id,
    is_read_later !== undefined ? (is_read_later ? 1 : 0) : link.is_read_later,
    review_date !== undefined ? review_date : link.review_date,
    review_status || link.review_status,
    id
  );

  // Update tags if provided
  if (tags !== undefined) {
    db.prepare('DELETE FROM link_tags WHERE link_id = ?').run(id);
    if (tags && tags.length > 0) {
      const insertTag = db.prepare('INSERT INTO link_tags (link_id, tag) VALUES (?, ?)');
      const insertTags = db.transaction((tagList) => {
        tagList.forEach((tag) => {
          if (tag.trim()) {
            insertTag.run(id, tag.trim());
          }
        });
      });
      insertTags(tags);
    }
  }

  // Fetch updated link
  const updatedLink = db.prepare(`
    SELECT l.*, c.name as category_name, c.color as category_color
    FROM links l
    LEFT JOIN categories c ON l.category_id = c.id
    WHERE l.id = ?
  `).get(id);

  const linkTags = db.prepare('SELECT tag FROM link_tags WHERE link_id = ?').all(id);

  res.json({
    ...updatedLink,
    tags: linkTags.map((t) => t.tag),
  });
});

// DELETE /api/links/:id - Delete a link
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  const db = getDb();

  const link = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(id, userId);
  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }

  db.prepare('DELETE FROM link_tags WHERE link_id = ?').run(id);
  db.prepare('DELETE FROM links WHERE id = ?').run(id);

  res.json({ message: 'Link deleted successfully' });
});

module.exports = router;
