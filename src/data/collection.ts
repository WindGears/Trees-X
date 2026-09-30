import { demoProduct, type Product, type ProductPart } from './products'
import { curate } from './exhibition'
import { reventon } from './reventon'

const original = {
  id: 'original',
  name: '原始材质',
  swatch: '#c0b9ac',
  color: [1, 1, 1] as [number, number, number],
  roughness: 1,
  original: true,
}
const finishes = [
  original,
  {
    id: 'cool',
    name: '冷调试色',
    swatch: '#8caad0',
    color: [0.52, 0.68, 0.9] as [number, number, number],
    roughness: 0.5,
  },
  {
    id: 'warm',
    name: '暖调试色',
    swatch: '#cfa87d',
    color: [0.9, 0.66, 0.4] as [number, number, number],
    roughness: 0.6,
  },
]
const base = import.meta.env.BASE_URL
const node = (slug: string, name: string) => `${slug}__part__${name}`
function part(
  slug: string,
  name: string,
  label: string,
  description: string,
  localPoint?: ProductPart['localPoint'],
): ProductPart {
  return {
    id: name,
    node: node(slug, name),
    name: label,
    description,
    face: 'any',
    cameraOffset: [1.8, 2, 3.2],
    localPoint,
  }
}
function product(
  slug: string,
  name: string,
  label: string,
  collection: Product['collection'],
  description: string,
  author: string,
  url: string,
  hotspots: ProductPart[],
  structure: Product['structure'] = [],
): Product {
  return {
    id: slug,
    name,
    label,
    collection,
    category: `${collection} · 三维样品`,
    description,
    modelUrl: `${base}models/collection/${slug}.glb`,
    coverUrl: `${base}covers/${slug}.jpg`,
    finish: '原始材质',
    finishes,
    finishNode: hotspots[0]!.node,
    hotspots,
    structure,
    structureSpace: 'world',
    source: { author, url, license: 'CC0' },
  }
}
const flatCamera: Product['camera'] = {
  perspective: [3.5, 4.5, 4.8],
  front: [0, 5, 4.8],
  back: [0, 5, -4.8],
}

const assets: Product[] = [
  { ...demoProduct, label: '桌面音箱', collection: '数码', coverUrl: `${base}covers/form-01.jpg` },
  {
    ...product(
      'gamepad',
      'GAME / 01',
      '复古游戏手柄',
      '数码',
      '按键、线缆与岁月留下的表面痕迹。靠近观察这件游戏设备的真实扫描材质。',
      'Josh Dean',
      'https://polyhaven.com/a/gamepad',
      [
        part(
          'gamepad',
          'gamepad',
          '手柄外观',
          '十字方向键与圆形按键分列两侧。靠近看，外壳上还留着细小的使用痕迹。',
          [0, 0.012, 0.16],
        ),
      ],
    ),
    camera: flatCamera,
  },
  {
    ...product(
      'gaming-console',
      'PLAY / 02',
      '复古游戏主机',
      '数码',
      '从完整机身到独立上盖，观察接口、接缝与塑料表面的细微变化。',
      'Sean Buckley',
      'https://polyhaven.com/a/gaming_console',
      [
        part(
          'gaming-console',
          'gaming-console',
          '主机外壳',
          '观察浅色塑料外壳的转角、接缝，以及侧面的接口轮廓。',
        ),
        part(
          'gaming-console',
          'gaming-console-lid',
          '接口盖板',
          '盖板与机身之间留有一道细缝。展开后，可以看清它与外壳的相对位置。',
        ),
      ],
      [{ nodes: [node('gaming-console', 'gaming-console-lid')], offset: [0, 0.6, 0.2] }],
    ),
    camera: flatCamera,
  },
  product(
    'oak-side-table',
    'WOOD / 03',
    '实木边桌',
    '家居',
    '木纹沿着桌面延伸，边角在侧光中浮现。旋转它，看看一件日常家具的细节。',
    'James Ray Cock',
    'https://polyhaven.com/a/side_table_01',
    [
      part(
        'oak-side-table',
        'side-table-01',
        '木作外观',
        '沿着桌面边缘，观察木纹的走向、圆润的转角与桌腿的衔接。',
      ),
    ],
  ),
  product(
    'potted-plant',
    'GROW / 04',
    '陶盆绿植',
    '家居',
    '叶面、枝干、石子与陶盆构成四个独立层次。在光影里观察植物的形态。',
    'Rico Cilliers',
    'https://polyhaven.com/a/potted_plant_01',
    [
      part(
        'potted-plant',
        'potted-plant-01-pot',
        '陶盆',
        '陶盆表面深浅不一的色泽，与细小的起伏一起呈现朴素的触感。试色只改变盆体。',
      ),
      part(
        'potted-plant',
        'potted-plant-01-leaves',
        '叶片',
        '叶片向不同方向舒展，大小与疏密各不相同。转动它，看光线经过叶缘。',
      ),
      part(
        'potted-plant',
        'potted-plant-01-pebbles',
        '盆内石子',
        '枝干周围铺着大小不一的石子。靠近观察它们与盆沿之间的远近层次。',
      ),
    ],
    [
      { nodes: [node('potted-plant', 'potted-plant-01-pot')], offset: [0, -0.45, 0] },
      { nodes: [node('potted-plant', 'potted-plant-01-pebbles')], offset: [0.65, 0, 0] },
      { nodes: [node('potted-plant', 'potted-plant-01-leaves')], offset: [0, 0.4, 0] },
    ],
  ),
  {
    ...product(
      'home-furniture-set',
      'ROOM / 05',
      '五件家具套件',
      '家居',
      '边桌、座椅、落地灯、地毯与盆栽，在同一个空间中组成一处小小的起居角。',
      'Kenney',
      'https://kenney.nl/assets/furniture-kit',
      [
        part(
          'home-furniture-set',
          'tablecoffee',
          '边桌',
          '小边桌连接着周围的家具。试色只改变这张桌子，其他物件保持原样。',
        ),
        part(
          'home-furniture-set',
          'chair',
          '座椅',
          '简洁的座椅与边桌相邻，留出一处小小的停留空间。',
        ),
        part(
          'home-furniture-set',
          'lamproundfloor',
          '落地灯',
          '细长的灯柱托起圆形灯罩，给这组低矮的家具增加了一条竖直轮廓。',
        ),
      ],
      [
        { nodes: [node('home-furniture-set', 'tablecoffee')], offset: [0, 0.3, 0] },
        { nodes: [node('home-furniture-set', 'chair')], offset: [0, 0, 0.6] },
        { nodes: [node('home-furniture-set', 'lamproundfloor')], offset: [-0.45, 0, -0.2] },
        { nodes: [node('home-furniture-set', 'pottedplant')], offset: [0.45, 0, -0.2] },
      ],
    ),
    camera: flatCamera,
  },
  {
    ...product(
      'toy-racer',
      'RACE / 06',
      '迷你赛车',
      '潮玩',
      '鲜明的车身与四个独立车轮，让旋转、试色与分层观察变得直观。',
      'Kenney',
      'https://kenney.nl/assets/car-kit',
      [
        part(
          'toy-racer',
          'body',
          '赛车车身',
          '鲜明色块勾勒出紧凑的车身。试色改变车身色泽，车轮保持原样。',
        ),
        part(
          'toy-racer',
          'wheel-front-left',
          '左前轮',
          '从侧面看，圆形车轮与车身轮拱相互呼应。展开结构时，它会向侧面移开。',
        ),
        part(
          'toy-racer',
          'wheel-front-right',
          '右前轮',
          '观察另一侧的轮拱与车轮，比较它们和车身之间的间隙。',
        ),
      ],
      [
        { nodes: [node('toy-racer', 'body')], offset: [0, 0.35, 0] },
        {
          nodes: [node('toy-racer', 'wheel-front-left'), node('toy-racer', 'wheel-back-left')],
          offset: [0.55, 0, 0],
        },
        {
          nodes: [node('toy-racer', 'wheel-front-right'), node('toy-racer', 'wheel-back-right')],
          offset: [-0.55, 0, 0],
        },
      ],
    ),
    camera: flatCamera,
  },
]
/** 打字机机械研究：程序化 572 件演绎重建，独立研究体验（无 GLB） */
const typewriter: Product = {
  id: 'typewriter-study',
  name: 'TYPE / 08',
  label: '机械打字机研究',
  collection: '机械',
  category: '机械 · 交互研究',
  description:
    'Kimi Portable：战前风格便携打字机的 572 件演绎重建。一个进度控制贯穿整机、爆炸分解与平铺陈列。',
  modelUrl: '',
  coverUrl: `${base}covers/typewriter-study.jpg`,
  finish: '缎面黑珐琅',
  finishes: [
    {
      id: 'prewar',
      name: '战前黑珐琅',
      swatch: '#1b1c20',
      color: [0.11, 0.11, 0.13],
      roughness: 0.4,
    },
  ],
  finishNode: '',
  hotspots: [],
  structure: [],
  experience: 'study',
}

export const collection = [...assets.map(curate), curate(typewriter), reventon]

export function findProduct(id: string) {
  return collection.find((item) => item.id === id)
}
