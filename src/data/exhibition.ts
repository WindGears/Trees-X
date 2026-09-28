import type { Product, ProductStage } from './products'

export const neutralStage: ProductStage = {
  kind: 'neutral',
  accent: '#b9cbdc',
  keyColor: '#fff4e8',
  fillColor: '#96a8c1',
  rimColor: '#d7e6fb',
  keyIntensity: 2.2,
  fillIntensity: 0.9,
  rimIntensity: 1.8,
  environmentIntensity: 0.85,
  ringOpacity: 0.07,
  bloom: 0.85,
}
export function stageFor(product: Product) {
  return product.stage ?? neutralStage
}
export function storyFor(product: Product) {
  return (
    product.storySteps ?? [
      { title: '看见完整轮廓', description: product.description, view: 'perspective' as const },
      {
        title: product.hotspots[0]?.name ?? '走近细节',
        description: product.hotspots[0]?.description ?? product.description,
        partId: product.hotspots[0]?.id,
      },
      ...(product.structure.length
        ? [
            {
              title: '观察外观层次',
              description: '让各个部分稍稍分开，看清它们在完整外观中的位置。',
              view: 'structure' as const,
            },
          ]
        : []),
    ]
  )
}

/** Editorial presentation stays separate from asset node ownership and source facts. */
export function curate(product: Product): Product {
  if (product.id === 'form-01')
    return {
      ...product,
      featuredRank: 1,
      description: '沿着金属的轮廓，走近声音的形状。',
      coverUrl: `${import.meta.env.BASE_URL}covers/exhibition/form-01.png`,
      stage: {
        ...neutralStage,
        kind: 'metal',
        accent: '#b7d5ed',
        keyIntensity: 0.65,
        fillIntensity: 0.15,
        rimIntensity: 0.65,
        environmentIntensity: 0.42,
        ringOpacity: 0,
        bloom: 0.32,
      },
      camera: {
        perspective: { position: [3.5, 1.1, 5.4], target: [0, -0.05, 0.05] },
        front: [0, 0.1, 6.2],
        back: [0, 0.4, -6.2],
        structure: [4.8, 2.5, 7.3],
      },
      zoomRange: [2.5, 10],
      storySteps: [
        {
          title: '圆与方的秩序',
          description: '方正外壳包裹两枚圆形单元。边框、悬边与振膜形成由外向内的层次。',
          partId: 'woofer',
        },
        {
          title: '指尖下的金属',
          description: '靠近顶部旋钮，观察环形凹槽，以及光线沿着圆周变化的反射。',
          partId: 'dial',
        },
        {
          title: '让层次浮现',
          description: '分开前面板、单元与底座，观察外观部件之间的关系。这是概念造型的分层演示。',
          view: 'structure',
        },
      ],
    }
  if (product.id === 'toy-racer')
    return {
      ...product,
      featuredRank: 2,
      description: '小小的车身，也有值得绕行的曲线。',
      coverUrl: `${import.meta.env.BASE_URL}covers/exhibition/toy-racer.png`,
      stage: {
        ...neutralStage,
        kind: 'play',
        accent: '#e7ae7d',
        keyColor: '#ffe4c8',
        fillColor: '#a6bdce',
        rimColor: '#ffbb79',
        keyIntensity: 2.6,
        rimIntensity: 2.6,
        ringOpacity: 0.045,
        bloom: 0.9,
      },
      camera: {
        perspective: { position: [3.5, 1.5, 4.7], target: [0, -0.1, 0] },
        front: { position: [0, 0.8, 5.3], target: [0, -0.1, 0] },
        back: [0, 1, -5.3],
        structure: [4.5, 3.5, 6.6],
      },
      zoomRange: [2.2, 10],
      storySteps: [
        {
          title: '低处看，轮廓更鲜明',
          description: '从车轮的高度观察车身。简化的几何形状与鲜明色块组成这辆迷你赛车。',
          view: 'perspective',
        },
        {
          title: '车轮与车身之间',
          description: '靠近左前轮，观察圆形车轮、轮拱和车身的衔接。',
          partId: 'wheel-front-left',
        },
        {
          title: '一辆车，几个部分',
          description: '车身向上，车轮向两侧分开。看清各部分的位置后，再将它们合拢。',
          view: 'structure',
        },
      ],
    }
  if (product.id === 'potted-plant')
    return {
      ...product,
      featuredRank: 3,
      description: '让光穿过叶间，发现日常里的细微层次。',
      coverUrl: `${import.meta.env.BASE_URL}covers/exhibition/potted-plant.png`,
      stage: {
        ...neutralStage,
        kind: 'botanical',
        accent: '#b5c9a4',
        keyColor: '#fff0da',
        fillColor: '#b8cbb0',
        rimColor: '#efffdc',
        keyIntensity: 1.8,
        fillIntensity: 0.65,
        rimIntensity: 1.6,
        environmentIntensity: 0.65,
        ringOpacity: 0,
        bloom: 0.45,
      },
      camera: {
        perspective: { position: [2.8, 1.2, 6.1], target: [0, 0, 0] },
        front: [0, 0.4, 6.5],
        back: [0, 0.5, -6.5],
        structure: [4.4, 2.6, 7.2],
      },
      zoomRange: [2.4, 10],
      storySteps: [
        {
          title: '光从叶间经过',
          description: '观察叶片朝向、疏密与枝条之间的空隙。改变角度，重叠的轮廓也随之变化。',
          partId: 'potted-plant-01-leaves',
        },
        {
          title: '陶土的表情',
          description: '靠近盆沿与盆身，看看表面深浅不一的色泽和细小起伏。',
          partId: 'potted-plant-01-pot',
        },
        {
          title: '盆里还有一层风景',
          description: '枝干周围铺着大小不同的石子。它们与盆沿、叶片一起形成远近层次。',
          partId: 'potted-plant-01-pebbles',
        },
      ],
    }
  if (product.id === 'gamepad')
    return {
      ...product,
      coverUrl: `${import.meta.env.BASE_URL}covers/exhibition/gamepad.png`,
      hotspots: product.hotspots.map((part) => ({ ...part, cameraOffset: [0.65, 1.5, 1.55] })),
      camera: {
        perspective: { position: [1.35, 2.3, 3], target: [0.055, 0.02, 1.01] },
        front: { position: [0.055, 2.9, 2.6], target: [0.055, 0.02, 1.01] },
        back: [0, 4.5, -4.5],
      },
      zoomRange: [1.2, 10],
    }
  return { ...product, coverUrl: `${import.meta.env.BASE_URL}covers/exhibition/${product.id}.png` }
}
