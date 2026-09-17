import { defineStore } from 'pinia'
import { ref } from 'vue'
import { linksApi, categoriesApi, tagsApi } from '../api'
import router from '../router'

export const PAGE_SIZE = 12

// Normalize user-typed search text exactly the way the server does:
// trim leading/trailing whitespace and collapse internal runs to a single space.
// Case is intentionally preserved for display; matching is case-insensitive.
export function normalizeSearchQuery(raw) {
  if (raw === null || raw === undefined) return ''
  return String(raw).trim().replace(/\s+/g, ' ')
}

// Build the query string shared by every list request so pagination, sorting
// and filters always run against the same conditions.
function buildListParams(page, state) {
  const params = { page, limit: PAGE_SIZE }
  if (state.selectedCategory) params.category = state.selectedCategory
  if (state.selectedTag) params.tag = state.selectedTag
  const search = normalizeSearchQuery(state.searchQuery)
  if (search) params.search = search
  return params
}

// Reflect the current list state in the URL query, so the page survives
// navigation away/back and a browser refresh.
function syncUrl(state) {
  if (router.currentRoute.value.name !== 'Home') return
  const query = {}
  if (state.selectedCategory) query.category = String(state.selectedCategory)
  if (state.selectedTag) query.tag = state.selectedTag
  const search = normalizeSearchQuery(state.searchQuery)
  if (search) query.q = search
  if (state.currentPage > 1) query.page = String(state.currentPage)

  const current = router.currentRoute.value.query
  const same =
    (current.category || '') === (query.category || '') &&
    (current.tag || '') === (query.tag || '') &&
    (current.q || '') === (query.q || '') &&
    (current.page || '') === (query.page || '')
  if (!same) {
    router.replace({ name: 'Home', query })
  }
}

export const useLinksStore = defineStore('links', () => {
  const links = ref([])
  const categories = ref([])
  const tags = ref([])
  const total = ref(0)
  const currentPage = ref(1)
  const totalPages = ref(1)
  const loading = ref(false)
  // Set when a fetch fails; the previous links/total are kept on screen.
  const error = ref('')

  // Filters
  const selectedCategory = ref(null)
  const selectedTag = ref(null)
  const searchQuery = ref('')

  // Monotonic token so a slow stale response can never overwrite a newer one
  // (e.g. type-search result arriving after a cleared-search result).
  let fetchSeq = 0

  async function fetchLinks(page = 1) {
    const seq = ++fetchSeq
    loading.value = true
    error.value = ''
    try {
      const response = await linksApi.getLinks(buildListParams(page, {
        selectedCategory: selectedCategory.value,
        selectedTag: selectedTag.value,
        searchQuery: searchQuery.value,
      }))
      if (seq !== fetchSeq) return // a newer request superseded this one
      links.value = response.data.links
      total.value = response.data.total
      currentPage.value = response.data.page
      totalPages.value = response.data.totalPages
      // The server may clamp an out-of-range page; keep the URL in sync.
      syncUrl(publicState())
    } catch (err) {
      if (seq !== fetchSeq) return
      // Keep the last successfully loaded list visible; surface a retry option.
      error.value = '链接加载失败，请检查网络后重试。'
      console.error('Failed to fetch links:', err)
    } finally {
      if (seq === fetchSeq) loading.value = false
    }
  }

  function retryFetch() {
    return fetchLinks(currentPage.value)
  }

  async function fetchCategories() {
    try {
      const response = await categoriesApi.getCategories()
      categories.value = response.data
    } catch (error) {
      console.error('Failed to fetch categories:', error)
    }
  }

  async function fetchTags() {
    try {
      const response = await tagsApi.getTags()
      tags.value = response.data
    } catch (error) {
      console.error('Failed to fetch tags:', error)
    }
  }

  async function createLink(data) {
    const response = await linksApi.createLink(data)
    await fetchLinks(currentPage.value)
    await fetchCategories()
    await fetchTags()
    return response.data
  }

  async function updateLink(id, data) {
    const response = await linksApi.updateLink(id, data)
    await fetchLinks(currentPage.value)
    await fetchCategories()
    await fetchTags()
    return response.data
  }

  async function deleteLink(id) {
    await linksApi.deleteLink(id)
    await fetchLinks(currentPage.value)
    await fetchCategories()
    await fetchTags()
  }

  async function createCategory(data) {
    const response = await categoriesApi.createCategory(data)
    await fetchCategories()
    return response.data
  }

  async function updateCategory(id, data) {
    const response = await categoriesApi.updateCategory(id, data)
    await fetchCategories()
    return response.data
  }

  async function deleteCategory(id) {
    await categoriesApi.deleteCategory(id)
    if (selectedCategory.value === Number(id) || selectedCategory.value === id) {
      selectedCategory.value = null
    }
    await fetchCategories()
    await fetchLinks(currentPage.value)
    syncUrl(publicState())
  }

  // Apply state coming from the URL (initial load / browser back-forward).
  // Does not itself rewrite the URL; returns true when anything changed.
  function applyQuery(query) {
    const nextCategory = query.category ? Number(query.category) : null
    const nextTag = query.tag ? String(query.tag) : null
    const nextSearch = normalizeSearchQuery(query.q)
    const nextPage = Math.max(1, Number(query.page) || 1)

    let changed = false
    if (selectedCategory.value !== nextCategory) {
      selectedCategory.value = nextCategory
      changed = true
    }
    if (selectedTag.value !== nextTag) {
      selectedTag.value = nextTag
      changed = true
    }
    if (searchQuery.value !== nextSearch) {
      searchQuery.value = nextSearch
      changed = true
    }
    if (currentPage.value !== nextPage) {
      currentPage.value = nextPage
      changed = true
    }
    return changed
  }

  function publicState() {
    return {
      selectedCategory: selectedCategory.value,
      selectedTag: selectedTag.value,
      searchQuery: searchQuery.value,
      currentPage: currentPage.value,
    }
  }

  // Any filter change resets to the first page; the URL is synced first so a
  // later server-side page clamp can still be reflected correctly.
  // Category and tag stay mutually exclusive, matching the sidebar UI.
  function setCategory(categoryId) {
    selectedCategory.value = categoryId ? Number(categoryId) : null
    selectedTag.value = null
    currentPage.value = 1
    syncUrl(publicState())
    fetchLinks(1)
  }

  function setTag(tag) {
    selectedTag.value = tag || null
    selectedCategory.value = null
    currentPage.value = 1
    syncUrl(publicState())
    fetchLinks(1)
  }

  function setSearch(query) {
    searchQuery.value = normalizeSearchQuery(query)
    currentPage.value = 1
    syncUrl(publicState())
    fetchLinks(1)
  }

  function clearSearch() {
    if (!searchQuery.value) return
    setSearch('')
  }

  function setPage(page) {
    currentPage.value = page
    syncUrl(publicState())
    fetchLinks(page)
  }

  function clearFilters() {
    selectedCategory.value = null
    selectedTag.value = null
    searchQuery.value = ''
    currentPage.value = 1
    syncUrl(publicState())
    fetchLinks(1)
  }

  return {
    links,
    categories,
    tags,
    total,
    currentPage,
    totalPages,
    loading,
    error,
    selectedCategory,
    selectedTag,
    searchQuery,
    fetchLinks,
    retryFetch,
    fetchCategories,
    fetchTags,
    createLink,
    updateLink,
    deleteLink,
    createCategory,
    updateCategory,
    deleteCategory,
    applyQuery,
    setCategory,
    setTag,
    setSearch,
    clearSearch,
    setPage,
    clearFilters,
  }
})
