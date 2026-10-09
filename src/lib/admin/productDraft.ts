import { computed, inject, nextTick, provide, reactive, ref, watch, type InjectionKey } from 'vue'
import { parseProduct } from '@/lib/workbench/api'
import type { ProductPresentation } from '@/lib/workbench/types'
import type { AdminDetail, Edit } from './api'
import { copy, fieldId, validateEditor, type EditorSection, type EditorIssue } from './editor'

export function createProductDraft(detail: AdminDetail, creating: boolean) {
  const item = ref({
    ...copy(detail.item),
    ...(creating ? { slug: '', name: '', listed: false, revision: 0 } : {}),
  })
  const presentation = ref<ProductPresentation>(copy(detail.presentation))
  const section = ref<EditorSection>('info')
  const numbers = reactive<Record<string, string>>({})
  const numberLabels = reactive<Record<string, { section: EditorSection; label: string }>>({})
  const json = ref(JSON.stringify(presentation.value, null, 2)),
    seed = ref(json.value),
    jsonError = ref('')
  const advancedDirty = computed(() => json.value !== seed.value)
  const serialize = () => JSON.stringify({ item: item.value, presentation: presentation.value })
  const baseline = ref(serialize())
  const issues = computed<EditorIssue[]>(() => [
    ...validateEditor(item.value, presentation.value),
    ...Object.entries(numbers).flatMap(([path, raw]) => {
      const meta = numberLabels[path]
      return meta && (!raw.trim() || !Number.isFinite(Number(raw)))
        ? [
            {
              section: meta.section,
              path,
              message: `请填写有效的${meta.label}，空值不会自动变成零。`,
            },
          ]
        : []
    }),
  ])
  const dirty = computed(
    () => advancedDirty.value || issues.value.length > 0 || serialize() !== baseline.value,
  )
  watch(
    presentation,
    () => {
      if (!advancedDirty.value) {
        seed.value = JSON.stringify(presentation.value, null, 2)
        json.value = seed.value
      }
    },
    { deep: true, flush: 'sync' },
  )
  function clearBuffers() {
    for (const key of Object.keys(numbers)) delete numbers[key]
  }
  function discardJson() {
    seed.value = JSON.stringify(presentation.value, null, 2)
    json.value = seed.value
    jsonError.value = ''
  }
  function choose(value: EditorSection) {
    if (section.value === 'advanced' && advancedDirty.value) {
      if (!window.confirm('高级JSON尚未应用。离开将放弃这部分输入，已编辑的表单仍保留。继续？'))
        return
      discardJson()
    }
    section.value = value
  }
  function applyJson() {
    try {
      const parsed = parseProduct({
        ...detail.item,
        presentation: JSON.parse(json.value) as unknown,
      })
      presentation.value = parsed.presentation
      clearBuffers()
      discardJson()
      return true
    } catch (e) {
      jsonError.value = e instanceof Error ? e.message : 'JSON格式不正确。'
      return false
    }
  }
  function payload(): Edit {
    if (advancedDirty.value) throw new Error('高级JSON尚未应用，请应用到表单或放弃输入。')
    if (issues.value.length) throw new Error('请先修正表单中的配置问题。')
    const parsed = parseProduct({
      ...item.value,
      cover: item.value.cover?.trim() || null,
      presentation: presentation.value,
    })
    return { ...item.value, cover: parsed.cover ?? null, presentation: parsed.presentation }
  }
  function accept(saved: AdminDetail) {
    clearBuffers()
    item.value = copy(saved.item)
    presentation.value = copy(saved.presentation)
    discardJson()
    baseline.value = serialize()
  }
  async function locate(issue: EditorIssue) {
    choose(issue.section)
    await nextTick()
    const element = document.getElementById(fieldId(issue.path))
    element?.scrollIntoView({ block: 'center', behavior: 'instant' })
    element?.focus()
  }
  return {
    item,
    presentation,
    section,
    numbers,
    numberLabels,
    json,
    jsonError,
    advancedDirty,
    dirty,
    issues,
    choose,
    applyJson,
    discardJson,
    payload,
    accept,
    locate,
  }
}
type ProductDraft = ReturnType<typeof createProductDraft>
const key: InjectionKey<ProductDraft> = Symbol('admin-product-draft')
export function provideProductDraft(draft: ProductDraft) {
  provide(key, draft)
}
export function useProductDraft() {
  const draft = inject(key)
  if (!draft) throw new Error('表单缺少商品编辑草稿')
  return draft
}
