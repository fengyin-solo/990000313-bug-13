<template>
  <div class="search-bar">
    <el-input
      v-model="searchText"
      placeholder="搜索链接..."
      prefix-icon="Search"
      clearable
      @keyup.enter="handleSearch"
      @clear="handleClear"
    >
      <template #append>
        <el-button @click="handleSearch">搜索</el-button>
      </template>
    </el-input>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useLinksStore } from '../stores/links'

const linksStore = useLinksStore()
const searchText = ref(linksStore.searchQuery)

// Keep the input in sync when the query changes elsewhere
// (clear all, closing the filter tag, restoring from the URL)
watch(
  () => linksStore.searchQuery,
  (val) => {
    searchText.value = val
  }
)

function handleSearch() {
  linksStore.setSearch(searchText.value)
}

function handleClear() {
  searchText.value = ''
  linksStore.setSearch('')
}
</script>

<style scoped>
.search-bar {
  flex: 1;
}
</style>
