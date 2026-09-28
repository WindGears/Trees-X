import { ref, triggerRef, onMounted, onUnmounted } from 'vue'

import gsap from 'gsap'

interface Particle {
  pos: [number, number, number]
  vel: [number, number, number]
  color: string
  opacity: number
}

export function useEnhancedDemo() {
  const gl = {
    clearColor: '#0a0c0f',
    alpha: false,
    antialias: true,
  }

  const isEnhanced = ref(true)
  const productPos = ref<[number, number, number]>([0, 0, 0])
  const productRot = ref<[number, number, number]>([0, 0, 0])
  const keyLightPos = ref<[number, number, number]>([4, 6, 3])
  const currentColor = ref('#b7bdc9')
  const materialRoughness = ref(0.2)

  const particles = ref<Particle[]>([])
  const animations = gsap.context(() => {})

  // 初始化粒子
  function initParticles() {
    const p: Particle[] = []
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2
      const radius = 2 + Math.random() * 0.5
      p.push({
        pos: [Math.cos(angle) * radius, (Math.random() - 0.5) * 2, Math.sin(angle) * radius] as [
          number,
          number,
          number,
        ],
        vel: [
          (Math.random() - 0.5) * 0.02,
          (Math.random() - 0.5) * 0.02,
          (Math.random() - 0.5) * 0.02,
        ] as [number, number, number],
        color: i % 3 === 0 ? '#4a9eff' : i % 3 === 1 ? '#9fc1ff' : '#6bb6ff',
        opacity: 0.3 + Math.random() * 0.4,
      })
    }
    particles.value = p
  }

  // 粒子更新
  function updateParticles() {
    if (!isEnhanced.value) return

    const time = Date.now() * 0.001
    const prodPos = productPos.value

    particles.value.forEach((p) => {
      const dx = prodPos[0] - p.pos[0]
      const dy = prodPos[1] - p.pos[1]
      const dz = prodPos[2] - p.pos[2]
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      // 吸引力
      if (dist < 1.2 && dist > 0.01) {
        const force = 0.008 / dist
        p.vel[0] -= dx * force
        p.vel[1] -= dy * force
        p.vel[2] -= dz * force
      } else if (dist > 2.5) {
        const force = 0.004 / dist
        p.vel[0] += dx * force
        p.vel[1] += dy * force
        p.vel[2] += dz * force
      }

      // 噪声
      p.vel[0] += Math.sin(time + p.pos[0] * 3) * 0.003
      p.vel[1] += Math.cos(time + p.pos[1] * 2) * 0.003
      p.vel[2] += Math.sin(time + p.pos[2] * 2.5) * 0.003

      // 阻尼
      p.vel[0] *= 0.98
      p.vel[1] *= 0.98
      p.vel[2] *= 0.98

      // 更新位置
      p.pos[0] += p.vel[0]
      p.pos[1] += p.vel[1]
      p.pos[2] += p.vel[2]
    })
  }

  // 静态粒子位置
  function getStaticPos(index: number): [number, number, number] {
    const angle = (index / 40) * Math.PI * 2
    const radius = 2.2
    return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius]
  }

  // 入场动画
  function playEnhancedIntro() {
    const tl = gsap.timeline()

    tl.from(productPos.value, {
      1: -3,
      duration: 1.2,
      ease: 'power2.out',
      onUpdate: () => {
        triggerRef(productPos)
      },
    })
      .from(
        productRot.value,
        {
          1: Math.PI * 0.5,
          duration: 1.2,
          ease: 'power2.out',
          onUpdate: () => {
            triggerRef(productRot)
          },
        },
        '<',
      )
      .from(
        keyLightPos.value,
        {
          0: -6,
          duration: 0.8,
          ease: 'power1.inOut',
          onUpdate: () => {
            triggerRef(keyLightPos)
          },
        },
        '-=0.4',
      )
      .to(productPos.value, {
        1: -0.1,
        duration: 0.3,
        ease: 'power2.in',
        onUpdate: () => {
          triggerRef(productPos)
        },
      })
      .to(productPos.value, {
        1: 0,
        duration: 0.4,
        ease: 'bounce.out',
        onUpdate: () => {
          triggerRef(productPos)
        },
      })

    return tl
  }

  // 待机动画
  function startIdleAnimation() {
    if (!isEnhanced.value) return

    gsap.to(productPos.value, {
      1: 0.15,
      duration: 3,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      onUpdate: () => {
        triggerRef(productPos)
      },
    })

    gsap.to(productRot.value, {
      1: '+=6.28',
      duration: 20,
      repeat: -1,
      ease: 'none',
      onUpdate: () => {
        triggerRef(productRot)
      },
    })

    gsap.to(materialRoughness, {
      value: 0.3,
      duration: 2.5,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
    })
  }

  // 试色动画
  const colors = ['#b7bdc9', '#8caad0', '#cfa87d', '#a4c9b5']
  let colorIndex = 0

  function triggerColorChange() {
    colorIndex = (colorIndex + 1) % colors.length
    const tl = gsap.timeline()
    tl.to(currentColor, { value: '#ffffff', duration: 0.15, ease: 'power2.in' }).to(currentColor, {
      value: colors[colorIndex],
      duration: 0.5,
      ease: 'power2.out',
    })

    particles.value.forEach((p, i) => {
      gsap.to(p, { opacity: 0.8, duration: 0.2, yoyo: true, repeat: 1, delay: i * 0.01 })
    })
  }

  // 切换版本
  function toggleVersion() {
    isEnhanced.value = !isEnhanced.value
    animations.revert()

    if (isEnhanced.value) {
      restartAnimation()
    } else {
      productPos.value = [0, 0, 0]
      productRot.value = [0, 0, 0]
      keyLightPos.value = [4, 6, 3]
    }
  }

  // 重播
  function restartAnimation() {
    animations.revert()
    productPos.value = [0, 0, 0]
    productRot.value = [0, 0, 0]
    keyLightPos.value = [4, 6, 3]
    currentColor.value = '#b7bdc9'
    colorIndex = 0

    if (isEnhanced.value) {
      animations.add(() => {
        playEnhancedIntro().then(() => animations.add(startIdleAnimation))
      })
    }
  }

  onMounted(() => {
    initParticles()
    restartAnimation()
    gsap.ticker.add(updateParticles)
  })

  onUnmounted(() => {
    gsap.ticker.remove(updateParticles)
    animations.revert()
  })
  const staticPositions = Array.from({ length: 40 }, (_, index) => getStaticPos(index + 1))
  return {
    gl,
    isEnhanced,
    productPos,
    productRot,
    keyLightPos,
    currentColor,
    materialRoughness,
    particles,
    staticPositions,
    toggleVersion,
    restartAnimation,
    triggerColorChange: () => animations.add(triggerColorChange),
  }
}
