import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'
import { getGlobalData, getPost } from '@/lib/db/getSiteData'
import { processPostData } from '@/lib/utils/post'
import { idToUuid } from 'notion-utils'
import { compressImage, mapImgUrl } from '@/lib/notion/mapImage'
import { isBrowser, loadExternalResource } from '@/lib/utils'
import mediumZoom from '@fisch0920/medium-zoom'
import 'katex/dist/katex.min.css'
import dynamic from 'next/dynamic'
import { useEffect, useRef } from 'react'
import { NotionRenderer } from 'react-notion-x'
import { useRouter } from 'next/router'

/**
 * 精简的NotionPage组件 - 仅用于fixed路由，无广告、无额外功能
 */
const MinimalNotionPage = ({ post }) => {
  const zoom =
    isBrowser &&
    mediumZoom({
      background: 'rgba(0, 0, 0, 0.2)',
      margin: getMediumZoomMargin()
    })

  const zoomRef = useRef(zoom ? zoom.clone() : null)
  const IMAGE_ZOOM_IN_WIDTH = siteConfig('IMAGE_ZOOM_IN_WIDTH', 1200)

  useEffect(() => {
    autoScrollToHash()
  }, [])

  useEffect(() => {
    const observer = new MutationObserver((mutationsList, observer) => {
      mutationsList.forEach(mutation => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class'
        ) {
          if (mutation.target.classList.contains('medium-zoom-image--opened')) {
            setTimeout(() => {
              const src = mutation?.target?.getAttribute('src')
              mutation?.target?.setAttribute(
                'src',
                compressImage(src, IMAGE_ZOOM_IN_WIDTH)
              )
            }, 800)
          }
        }
      })
    })

    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['class']
    })

    return () => {
      observer.disconnect()
    }
  }, [post])

  return (
    <div id='notion-article' className="mx-auto overflow-hidden">
      <NotionRenderer
        recordMap={post?.blockMap}
        mapPageUrl={mapPageUrl}
        mapImageUrl={mapImgUrl}
        components={{
          Code,
          Collection,
          Equation,
          Modal,
          Pdf
        }}
      />
    </div>
  )
}

/**
 * 纯文章展示页面 - 只显示文章内容，无其他界面元素
 * 路由: /fixed/[slug]
 * @param {*} props
 * @returns
 */
const FixedSlug = props => {
  const { post } = props
  const router = useRouter()

  useEffect(() => {
    // 404检测 - 简化版本
    if (!post && router.isReady) {
      const timer = setTimeout(() => {
        router.push('/404')
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [post, router.isReady])

  // 如果路由还没准备好，显示加载中
  if (!router.isReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">加载中...</div>
      </div>
    )
  }

  // 如果没有文章数据
  if (!post) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8">
        <div className="text-gray-500 text-center">
          <h2 className="text-xl mb-4">文章未找到</h2>
          <p>请检查URL是否正确</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      {/* 纯净的文章内容展示 */}
      <article
        id="fixed-article"
        className="max-w-4xl mx-auto px-4 py-8"
        itemScope
        itemType="https://schema.org/Article"
      >
        {/* 只渲染 Notion 文章内容，无其他任何元素 */}
        <MinimalNotionPage post={post} />
      </article>
    </div>
  )
}

export async function getStaticPaths() {
  if (!BLOG.isProd) {
    return {
      paths: [],
      fallback: true
    }
  }

  const from = 'fixed-slug-paths'
  const { allPages } = await getGlobalData({ from })

  // 生成所有已发布文章的路径
  const paths = allPages
    ?.filter(row => row.type === 'Post' && row.status === 'Published')
    .map(row => ({
      params: { slug: row.slug }
    }))

  return {
    paths: paths || [],
    fallback: true
  }
}

export async function getStaticProps({ params: { slug }, locale }) {
  const from = `fixed-slug-props-${slug}`
  const props = await getGlobalData({ from, locale })

  console.log(`[Fixed] 查找文章: ${slug}`)
  console.log(`[Fixed] 总页面数: ${props?.allPages?.length || 0}`)

  // 调试：列出所有文章的slug
  const allSlugs = props?.allPages?.filter(p => p.type.indexOf('Menu') < 0).map(p => p.slug) || []
  console.log(`[Fixed] 所有文章slug:`, allSlugs.slice(0, 10)) // 只显示前10个

  // 在列表内查找文章 - 支持多种slug格式匹配
  props.post = props?.allPages?.find(p => {
    const match = p.type.indexOf('Menu') < 0 && (
      p.slug === slug ||                           // 直接匹配 example-1
      p.slug === `article/${slug}` ||              // 匹配 article/example-1
      p.slug.endsWith(`/${slug}`) ||               // 匹配任何以 /example-1 结尾的
      p.id === idToUuid(slug)                      // ID匹配
    )
    if (match) {
      console.log(`[Fixed] 找到匹配文章: ${p.slug}, type: ${p.type}`)
    }
    return match
  })

  // 处理非列表内文章
  if (!props?.post) {
    console.log(`[Fixed] 在allPages中未找到，尝试直接获取`)
    const pageId = slug
    if (pageId.length >= 32) {
      const post = await getPost(pageId)
      props.post = post
    }
  }

  if (!props?.post) {
    console.log(`[Fixed] 最终未找到文章: ${slug}`)
    // 无法获取文章
    props.post = null
  } else {
    console.log(`[Fixed] 成功获取文章: ${props.post.title}`)
    await processPostData(props, from)
  }

  return {
    props,
    revalidate: process.env.EXPORT
      ? undefined
      : siteConfig(
          'NEXT_REVALIDATE_SECOND',
          BLOG.NEXT_REVALIDATE_SECOND,
          props.NOTION_CONFIG
        )
  }
}

/**
 * 根据url参数自动滚动到锚位置
 */
const autoScrollToHash = () => {
  setTimeout(() => {
    const hash = window?.location?.hash
    const needToJumpToTitle = hash && hash.length > 0
    if (needToJumpToTitle) {
      console.log('jump to hash', hash)
      const tocNode = document.getElementById(hash.substring(1))
      if (tocNode && tocNode?.className?.indexOf('notion') > -1) {
        tocNode.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }
    }
  }, 180)
}

/**
 * 将id映射成博文内部链接。
 * @param {*} id
 * @returns
 */
const mapPageUrl = id => {
  return '/' + id.replace(/-/g, '')
}

/**
 * 缩放
 * @returns
 */
function getMediumZoomMargin() {
  if (!isBrowser) return 20

  const width = window.innerWidth

  if (width < 500) {
    return 8
  } else if (width < 800) {
    return 20
  } else if (width < 1280) {
    return 30
  } else if (width < 1600) {
    return 40
  } else if (width < 1920) {
    return 48
  } else {
    return 72
  }
}

// 代码
const Code = dynamic(
  () =>
    import('react-notion-x/build/third-party/code').then(m => {
      return m.Code
    }),
  { ssr: false }
)

// 公式
const Equation = dynamic(
  () =>
    import('@/components/Equation').then(async m => {
      await import('@/lib/plugins/mhchem')
      return m.Equation
    }),
  { ssr: false }
)

// 原版文档
const Pdf = dynamic(() => import('@/components/Pdf').then(m => m.Pdf), {
  ssr: false
})

const Collection = dynamic(
  () =>
    import('react-notion-x/build/third-party/collection').then(
      m => m.Collection
    ),
  {
    ssr: true
  }
)

const Modal = dynamic(
  () => import('react-notion-x/build/third-party/modal').then(m => m.Modal),
  { ssr: false }
)

export default FixedSlug