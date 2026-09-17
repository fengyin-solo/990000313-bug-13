<template>
  <div class="search-bar">
    <el-input
      v-model="searchText"
      placeholder="搜索标题、描述、网址或标签..."
      prefix-icon="Search"
      clearable
      @keyup.enter="handleSearch"
      @clear="handleClear"
      @input="handleInput"
    >
      <template #append>
        <el-button :loading="linksStore.loading" @click="handleSearch">搜索</el-button>
      </template>
    </el-input>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useLinksStore, normalizeSearchQuery } from '../stores/links'

const linksStore = useLinksStore()
const searchText = ref(linksStore.searchQuery)

// Reflect external state changes (browser back/forward, filter tag removal)
// into the input without overwriting what the user is currently typing.
watch(
  () => linksStore.searchQuery,
  (query) => {
    if (normalizeSearchQuery(searchText.value) !== normalizeSearchQuery(query)) {
      searchText.value = query
    }
  }
)

function handleSearch() {
  linksStore.setSearch(searchText.value)
  // Show the normalized form (trimmed, collapsed spaces) after committing.
  searchText.value = linksStore.searchQuery
}

function handleInput(value) {
  // Clearing the box (by hand or via the clear icon) must immediately restore
  // the unfiltered list instead of leaving the previous results behind.
  if (normalizeSearchQuery(value) === '') {
    linksStore.clearSearch()
  }
}

function handleClear() {
  searchText.value = ''
  linksStore.clearSearch()
}
</script>

<style scoped>
.search-bar {
  flex: 1;
}
</style>
