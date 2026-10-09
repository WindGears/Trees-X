<script setup lang="ts">
import { ref } from 'vue'
import { adminApi, message } from '@/lib/admin/api'
defineProps<{ expired: boolean }>()
const emit = defineEmits<{ authenticated: [value: { username: string }] }>()
const username = ref(''),
  password = ref(''),
  error = ref(''),
  busy = ref(false)
async function login() {
  busy.value = true
  error.value = ''
  try {
    emit('authenticated', await adminApi.login(username.value, password.value))
    password.value = ''
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <form class="ad-login" @submit.prevent="login">
    <h1>{{ expired ? '重新登录' : '管理员登录' }}</h1>
    <p>
      {{
        expired
          ? '会话已结束。重新登录后可继续保存当前输入。'
          : '维护商品信息、展示配置与目录。访客浏览无需登录。'
      }}
    </p>
    <label
      >管理员账号<input v-model="username" required autocomplete="username" maxlength="80"
    /></label>
    <label
      >密码<input
        v-model="password"
        required
        type="password"
        autocomplete="current-password"
        maxlength="72"
    /></label>
    <p v-if="error" role="alert" class="ad-error">{{ error }}</p>
    <button type="submit" class="ad-primary" :disabled="busy">
      {{ busy ? '正在登录…' : '登录管理端' }}
    </button>
  </form>
</template>
