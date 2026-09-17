<template>
  <div class="home-container">
    <div class="main-layout">
      <aside class="sidebar">
        <CategorySidebar />
        <TagCloud />
      </aside>
      <main class="content">
        <div class="content-header">
          <SearchBar />
          <el-button type="primary" @click="showAddDialog">
            <el-icon><Plus /></el-icon>
            添加链接
          </el-button>
        </div>

        <div class="active-filters" v-if="linksStore.selectedCategory || linksStore.selectedTag || linksStore.searchQuery">
          <span class="filter-label">当前筛选:</span>
          <el-tag v-if="linksStore.searchQuery" closable @close="linksStore.setSearch('')">
            搜索: {{ linksStore.searchQuery }}
          </el-tag>
          <el-tag v-if="activeCategoryName" type="success" closable @close="linksStore.setCategory(null)">
            分类: {{ activeCategoryName }}
          </el-tag>
          <el-tag v-if="linksStore.selectedTag" type="warning" closable @close="linksStore.setTag(null)">
            标签: {{ linksStore.selectedTag }}
          </el-tag>
          <el-button type="primary" link @click="linksStore.clearFilters()">清除全部</el-button>
        </div>

        <el-alert
          v-if="linksStore.fetchError"
          :title="linksStore.fetchError"
          type="error"
          show-icon
          :closable="false"
          class="fetch-error"
        >
          <template #default>
            <el-button size="small" @click="handleRetry">重试</el-button>
          </template>
        </el-alert>

        <div v-loading="linksStore.loading" class="links-grid">
          <LinkCard
            v-for="link in linksStore.links"
            :key="link.id"
            :link="link"
            @edit="handleEdit"
            @delete="handleDelete"
            @tag-click="linksStore.setTag"
          />
        </div>

        <div class="pagination" v-if="linksStore.totalPages > 1">
          <el-pagination
            v-model:current-page="linksStore.currentPage"
            :page-size="12"
            :total="linksStore.total"
            layout="prev, pager, next"
            @current-change="handlePageChange"
          />
        </div>

        <el-empty
          v-if="!linksStore.loading && !linksStore.fetchError && linksStore.links.length === 0"
          :description="emptyDescription"
        />
      </main>
    </div>

    <LinkForm
      v-model:visible="formVisible"
      :link="editingLink"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useLinksStore } from '../stores/links'
import CategorySidebar from '../components/CategorySidebar.vue'
import TagCloud from '../components/TagCloud.vue'
import SearchBar from '../components/SearchBar.vue'
import LinkCard from '../components/LinkCard.vue'
import LinkForm from '../components/LinkForm.vue'

const linksStore = useLinksStore()
const route = useRoute()
const router = useRouter()

const formVisible = ref(false)
const editingLink = ref(null)

const activeCategoryName = computed(() => {
  if (!linksStore.selectedCategory) return null
  const cat = linksStore.categories.find((c) => c.id === linksStore.selectedCategory)
  return cat?.name
})

const hasActiveFilters = computed(
  () => !!(linksStore.searchQuery || linksStore.selectedCategory || linksStore.selectedTag)
)

const emptyDescription = computed(() =>
  hasActiveFilters.value
    ? '没有找到匹配的链接，请调整搜索词或筛选条件'
    : '暂无链接，点击右上角「添加链接」开始收藏'
)

onMounted(() => {
  const { search, category, tag, page } = route.query
  const hasQuery =
    search !== undefined || category !== undefined || tag !== undefined || page !== undefined

  if (hasQuery) {
    // Deep link / refresh: the URL is the source of truth
    linksStore.applyQuery({ search, category, tag })
    linksStore.fetchLinks(Math.max(1, parseInt(page, 10) || 1))
  } else {
    // Navigating back from another page: keep the previous list state
    linksStore.fetchLinks(linksStore.currentPage)
  }
  linksStore.fetchCategories()
  linksStore.fetchTags()
})

// Reflect list state in the URL so refresh and back/forward restore the same
// page, keyword and filters
watch(
  () => [
    linksStore.currentPage,
    linksStore.searchQuery,
    linksStore.selectedCategory,
    linksStore.selectedTag,
  ],
  ([page, search, category, tag]) => {
    const query = {}
    if (search) query.search = search
    if (category != null) query.category = String(category)
    if (tag) query.tag = tag
    if (page > 1) query.page = String(page)

    const current = route.query
    const same =
      Object.keys(query).length === Object.keys(current).length &&
      Object.keys(query).every((k) => current[k] === query[k])
    if (!same) {
      router.replace({ query })
    }
  }
)

function showAddDialog() {
  editingLink.value = null
  formVisible.value = true
}

function handleEdit(link) {
  editingLink.value = { ...link }
  formVisible.value = true
}

async function handleDelete(link) {
  try {
    await ElMessageBox.confirm(`确定要删除 "${link.title}" 吗？`, '确认删除', {
      type: 'warning',
    })
    await linksStore.deleteLink(link.id)
    ElMessage.success('删除成功')
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

function handleSaved() {
  formVisible.value = false
  editingLink.value = null
}

function handlePageChange(page) {
  linksStore.fetchLinks(page)
}

function handleRetry() {
  linksStore.fetchLinks(linksStore.currentPage)
}
</script>

<style scoped>
.home-container {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.main-layout {
  display: flex;
  gap: 20px;
}

.sidebar {
  width: 260px;
  flex-shrink: 0;
}

.content {
  flex: 1;
  min-width: 0;
}

.content-header {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  align-items: center;
}

.content-header .el-button {
  flex-shrink: 0;
}

.active-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.filter-label {
  font-size: 14px;
  color: #606266;
}

.fetch-error {
  margin-bottom: 16px;
}

.links-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  min-height: 200px;
}

.pagination {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}
</style>
