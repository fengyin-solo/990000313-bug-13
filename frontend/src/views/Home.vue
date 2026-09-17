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
          <el-tag v-if="linksStore.searchQuery" closable @close="linksStore.clearSearch()">
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

        <div v-loading="linksStore.loading" class="links-grid">
          <LinkCard
            v-for="link in linksStore.links"
            :key="link.id"
            :link="link"
            @edit="handleEdit"
            @delete="handleDelete"
          />
        </div>

        <div v-if="linksStore.error" class="fetch-error">
          <el-alert
            :title="linksStore.error"
            type="error"
            show-icon
            :closable="false"
          >
            <el-button type="primary" size="small" :loading="linksStore.loading" @click="linksStore.retryFetch()">
              重试
            </el-button>
          </el-alert>
        </div>

        <div class="pagination" v-if="!linksStore.error && linksStore.totalPages > 1">
          <el-pagination
            v-model:current-page="linksStore.currentPage"
            :page-size="12"
            :total="linksStore.total"
            layout="prev, pager, next"
            @current-change="handlePageChange"
          />
        </div>

        <el-empty
          v-if="!linksStore.loading && !linksStore.error && linksStore.links.length === 0"
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
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useLinksStore } from '../stores/links'
import CategorySidebar from '../components/CategorySidebar.vue'
import TagCloud from '../components/TagCloud.vue'
import SearchBar from '../components/SearchBar.vue'
import LinkCard from '../components/LinkCard.vue'
import LinkForm from '../components/LinkForm.vue'

const linksStore = useLinksStore()
const route = useRoute()

const formVisible = ref(false)
const editingLink = ref(null)

const activeCategoryName = computed(() => {
  if (!linksStore.selectedCategory) return null
  const cat = linksStore.categories.find((c) => c.id === linksStore.selectedCategory)
  return cat?.name
})

const hasActiveFilter = computed(
  () => Boolean(linksStore.selectedCategory || linksStore.selectedTag || linksStore.searchQuery)
)

const emptyDescription = computed(() => {
  if (linksStore.searchQuery) {
    return `没有找到与 “${linksStore.searchQuery}” 匹配的链接，换个关键词试试`
  }
  if (hasActiveFilter.value) {
    return '当前筛选条件下没有链接'
  }
  return '暂无链接'
})

// Load the list according to the URL query so deep links, refresh and browser
// back/forward restore the same page, sort position and filters.
let initialized = false
function loadFromRoute() {
  const changed = linksStore.applyQuery(route.query)
  // Store actions already trigger their own fetch after rewriting the URL;
  // in that case applyQuery finds no diff and we must not double-fetch.
  if (changed || !initialized) {
    initialized = true
    linksStore.fetchLinks(linksStore.currentPage)
  }
}

const stopRouteWatch = watch(
  () => route.query,
  () => loadFromRoute()
)

onMounted(() => {
  loadFromRoute()
  linksStore.fetchCategories()
  linksStore.fetchTags()
})

onBeforeUnmount(() => {
  stopRouteWatch()
})

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
  linksStore.setPage(page)
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

.fetch-error {
  margin: 16px 0;
  display: flex;
  justify-content: center;
}

.fetch-error :deep(.el-alert) {
  width: 100%;
  max-width: 480px;
}
</style>
