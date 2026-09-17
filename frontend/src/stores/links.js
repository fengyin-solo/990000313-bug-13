import { defineStore } from 'pinia'
import { ref } from 'vue'
import { linksApi, categoriesApi, tagsApi } from '../api'

const PAGE_SIZE = 12

export const useLinksStore = defineStore('links', () => {
  const links = ref([])
  const categories = ref([])
  const tags = ref([])
  const total = ref(0)
  const currentPage = ref(1)
  const totalPages = ref(1)
  const loading = ref(false)
  const fetchError = ref('')

  // Filters
  const selectedCategory = ref(null)
  const selectedTag = ref(null)
  const searchQuery = ref('')

  // Page the user was on before a search started; restored when it is cleared
  let pageBeforeSearch = 1
  // Sequence id so only the latest request applies its result. Without this a
  // slow earlier request (e.g. a search) can overwrite a newer one (e.g. the
  // unfiltered list after clearing the box) and leave stale results on screen.
  let fetchSeq = 0

  async function fetchLinks(page = 1) {
    const seq = ++fetchSeq
    loading.value = true
    fetchError.value = ''
    try {
      const params = {
        page,
        limit: PAGE_SIZE,
      }
      if (selectedCategory.value) params.category = selectedCategory.value
      if (selectedTag.value) params.tag = selectedTag.value
      const keyword = searchQuery.value.trim()
      if (keyword) params.search = keyword

      const response = await linksApi.getLinks(params)
      if (seq !== fetchSeq) return // a newer request is in flight; drop this stale result

      let data = response.data
      // Requested page no longer exists (items deleted, filters changed):
      // fall back to the last available page instead of showing a blank list
      if (data.links.length === 0 && data.total > 0 && data.page > 1) {
        const lastPage = Math.ceil(data.total / PAGE_SIZE)
        const retry = await linksApi.getLinks({ ...params, page: lastPage })
        if (seq !== fetchSeq) return
        data = retry.data
      }

      links.value = data.links
      total.value = data.total
      currentPage.value = data.page
      totalPages.value = data.totalPages
    } catch (error) {
      if (seq !== fetchSeq) return
      console.error('Failed to fetch links:', error)
      // Keep the previous list on screen; the view shows a retryable error
      fetchError.value = '链接加载失败，请检查网络后重试'
    } finally {
      if (seq === fetchSeq) loading.value = false
    }
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
    if (selectedCategory.value === id) {
      selectedCategory.value = null
    }
    await fetchCategories()
    await fetchLinks(currentPage.value)
  }

  function setCategory(categoryId) {
    selectedCategory.value = categoryId
    selectedTag.value = null
    pageBeforeSearch = 1
    fetchLinks(1)
  }

  function setTag(tag) {
    selectedTag.value = tag
    selectedCategory.value = null
    pageBeforeSearch = 1
    fetchLinks(1)
  }

  function setSearch(query) {
    const keyword = (query || '').trim()
    if (keyword === searchQuery.value) return
    if (!searchQuery.value && keyword) {
      // Entering a search: remember where the unfiltered list was
      pageBeforeSearch = currentPage.value
    }
    searchQuery.value = keyword
    // Clearing the search returns to the page and order from before it
    fetchLinks(keyword ? 1 : pageBeforeSearch)
  }

  function clearFilters() {
    selectedCategory.value = null
    selectedTag.value = null
    searchQuery.value = ''
    pageBeforeSearch = 1
    fetchLinks(1)
  }

  // Restore filter state from the route query without fetching (the caller
  // triggers fetchLinks with the right page afterwards)
  function applyQuery({ search, category, tag } = {}) {
    const categoryId = Number(category)
    searchQuery.value = (search || '').trim()
    selectedCategory.value =
      category != null && category !== '' && Number.isInteger(categoryId) ? categoryId : null
    selectedTag.value = tag || null
    pageBeforeSearch = 1
  }

  return {
    links,
    categories,
    tags,
    total,
    currentPage,
    totalPages,
    loading,
    fetchError,
    selectedCategory,
    selectedTag,
    searchQuery,
    fetchLinks,
    fetchCategories,
    fetchTags,
    createLink,
    updateLink,
    deleteLink,
    createCategory,
    updateCategory,
    deleteCategory,
    setCategory,
    setTag,
    setSearch,
    clearFilters,
    applyQuery,
  }
})
