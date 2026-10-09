<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from 'vue'
import { adminApi, message, ApiError } from '@/lib/admin/api'
import AdminLogin from './AdminLogin.vue'
import AdminProducts from './AdminProducts.vue'
import AdminCategories from './AdminCategories.vue'
import '@/assets/styles/admin.css'
const session = ref<{ username: string } | null>(null)
const checked = ref(false),
  ever = ref(false),
  error = ref(''),
  busy = ref(false)
const tab = ref<'products' | 'categories'>('products'),
  dirty = ref(false)
async function check() {
  error.value = ''
  try {
    session.value = await adminApi.session()
    ever.value = true
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) error.value = message(e)
  } finally {
    checked.value = true
  }
}
function authenticated(value: { username: string }) {
  session.value = value
  ever.value = true
  error.value = ''
}
function change(value: typeof tab.value) {
  if (
    value === tab.value ||
    (dirty.value && !window.confirm('尚有未保存的修改，离开后将丢弃。继续离开？'))
  )
    return
  dirty.value = false
  tab.value = value
}
async function logout() {
  if (dirty.value && !window.confirm('尚有未保存的修改，退出后将丢弃。继续退出？')) return
  busy.value = true
  try {
    await adminApi.logout()
    session.value = null
    ever.value = false
    dirty.value = false
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
const expired = () => {
  session.value = null
}
function leaving(event: BeforeUnloadEvent) {
  if (dirty.value) event.preventDefault()
}
onMounted(() => {
  document.title = '商品管理 · Trees X'
  void check()
  window.addEventListener('trees-admin-expired', expired)
  window.addEventListener('beforeunload', leaving)
})
onScopeDispose(() => {
  window.removeEventListener('trees-admin-expired', expired)
  window.removeEventListener('beforeunload', leaving)
})
</script>
<template>
  <div class="tx-admin">
    <a class="skip-link" href="#admin-main">跳转到管理内容</a>
    <header class="ad-header">
      <a class="ad-brand" href="/">Trees X <span>内容管理</span></a>
      <a href="/">打开商品工作台</a>
      <span v-if="session">{{ session.username }}</span>
      <button v-if="session" type="button" :disabled="busy" @click="logout">退出登录</button>
    </header>
    <main id="admin-main">
      <p v-if="!checked" role="status" class="ad-loading">正在检查管理员会话…</p>
      <div v-if="error" role="alert" class="ad-error">
        {{ error }} <button type="button" @click="check">重试连接</button>
      </div>
      <AdminLogin v-if="checked && !session" :expired="ever" @authenticated="authenticated" />
      <div v-if="ever" v-show="session" class="ad-shell">
        <nav aria-label="管理模块" class="ad-nav">
          <button
            type="button"
            :aria-current="tab === 'products' ? 'page' : undefined"
            @click="change('products')"
          >
            商品与展示配置
          </button>
          <button
            type="button"
            :aria-current="tab === 'categories' ? 'page' : undefined"
            @click="change('categories')"
          >
            商品分类
          </button>
          <p>管理内容保存到本机数据库。上架商品的修改会在访客重新加载后生效。</p>
        </nav>
        <AdminProducts v-if="tab === 'products'" @dirty="dirty = $event" />
        <AdminCategories v-else @dirty="dirty = $event" />
      </div>
    </main>
  </div>
</template>
