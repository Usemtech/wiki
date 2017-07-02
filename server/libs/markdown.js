'use strict'

const md = require('markdown-it')
const mdEmoji = require('markdown-it-emoji')
const mdTaskLists = require('markdown-it-task-lists')
const mdAbbr = require('markdown-it-abbr')
const mdAnchor = require('markdown-it-anchor')
const mdFootnote = require('markdown-it-footnote')
const mdExternalLinks = require('markdown-it-external-links')
const mdExpandTabs = require('markdown-it-expand-tabs')
const mdAttrs = require('markdown-it-attrs')
const hljs = require('highlight.js')
const cheerio = require('cheerio')
const _ = require('lodash')
const mdRemove = require('remove-markdown')

// Load plugins

var mkdown = md({
  html: true,
  linkify: true,
  typography: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return '<pre class="hljs"><code>' + hljs.highlight(lang, str, true).value + '</code></pre>'
      } catch (err) {
        return '<pre><code>' + _.escape(str) + '</code></pre>'
      }
    }
    return '<pre><code>' + _.escape(str) + '</code></pre>'
  }
})
  .use(mdEmoji)
  .use(mdTaskLists)
  .use(mdAbbr)
  .use(mdAnchor, {
    slugify: _.kebabCase,
    permalink: true,
    permalinkClass: 'toc-anchor icon-anchor',
    permalinkSymbol: '',
    permalinkBefore: true
  })
  .use(mdFootnote)
  .use(mdExternalLinks, {
    externalClassName: 'external-link',
    internalClassName: 'internal-link'
  })
  .use(mdExpandTabs, {
    tabWidth: 4
  })
  .use(mdAttrs)

if (appconfig) {
  const mdMathjax = require('markdown-it-mathjax')
  mkdown.use(mdMathjax())
}

// Rendering rules

mkdown.renderer.rules.emoji = function (token, idx) {
  return '<i class="twa twa-' + _.replace(token[idx].markup, /_/g, '-') + '"></i>'
}

// Video rules

const videoRules = [
  {
    selector: 'a.youtube',
    regexp: new RegExp(/(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/)|(?:(?:watch)?\?v(?:i)?=|&v(?:i)?=))([^#&?]*).*/i),
    output: '<iframe width="640" height="360" src="https://www.youtube.com/embed/{0}?rel=0" frameborder="0" allowfullscreen></iframe>'
  },
  {
    selector: 'a.vimeo',
    regexp: new RegExp(/vimeo.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^/]*)\/videos\/|album\/(?:\d+)\/video\/|)(\d+)(?:$|\/|\?)/i),
    output: '<iframe src="https://player.vimeo.com/video/{0}" width="640" height="360" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>'
  },
  {
    selector: 'a.dailymotion',
    regexp: new RegExp(/(?:dailymotion\.com(?:\/embed)?(?:\/video|\/hub)|dai\.ly)\/([0-9a-z]+)(?:[-_0-9a-zA-Z]+(?:#video=)?([a-z0-9]+)?)?/i),
    output: '<iframe width="640" height="360" src="//www.dailymotion.com/embed/video/{0}?endscreen-enable=false" frameborder="0" allowfullscreen></iframe>'
  },
  {
    selector: 'a.video',
    regexp: false,
    output: '<video width="640" height="360" controls preload="metadata"><source src="{0}" type="video/mp4"></video>'
  }
]

// Non-markdown filter

const textRegex = new RegExp('\\b[a-z0-9-.,' + appdata.regex.cjk + appdata.regex.arabic + ']+\\b', 'g')

/**
 * @param     {Array<Node>} array The TOC as a flat array.
 * @param     {Number} requestedLevel the level of the TOC to build.
 * @param     {Context} requestedLevelContext context for building TOC at the `requestedLevel`.
 * @param     {Number} requestedLevelContext.startFrom the index in `array` to start from.
 * @return    {Array<Node>} TOC as a tree at the `requestedLevel`.
 */
function buildTreeFlatArray(array, requestedLevel, requestedLevelContext) {
  requestedLevel = requestedLevel || 1
  requestedLevelContext = requestedLevelContext || {}
  requestedLevelContext.startFrom = requestedLevelContext.startFrom || 0

  let requestedLevelTree = []

  let index = requestedLevelContext.startFrom
  while (index < array.length) {
    let currentNode = array[index]

    // stop when the level of the current node is smaller than the requested level
    if (currentNode.level < requestedLevel) {
      break
    }

    // add nodes with level equal to the requested level to the tree
    else if (currentNode.level === requestedLevel) {
      requestedLevelTree.push({
        content: currentNode.content,
        anchor: currentNode.anchor,
        nodes: []
      })

      // go to next node
      index++
    }

    // build a tree from nodes with level greater than the requested level
    // and it to the last node in the requested level tree
    else {
      let nextLevelContext = {
        startFrom: index
      }
      let nextLevelTree = buildTreeFlatArray(array, currentNode.level, nextLevelContext)
      requestedLevelTree[requestedLevelTree.length - 1].nodes = nextLevelTree

      // continue from where processing of children has stoped
      index = nextLevelContext.startFrom
    }
  }

  // remember the last processed position
  requestedLevelContext.startFrom = index

  return requestedLevelTree
}

/**
 * Parse markdown content and build TOC tree
 *
 * @param      {(Function|string)}  content  Markdown content
 * @return     {Array}             TOC tree
 */
const parseTree = (content) => {
  content = content.replace(/<!--(.|\t|\n|\r)*?-->/g, '')
  let tokens = md().parse(content, {})
  let tocArray = []

  // -> Extract headings and their respective levels

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_close') {
      continue
    }

    const heading = tokens[i - 1]
    const headingclose = tokens[i]

    if (heading.type === 'inline') {
      let content = ''
      let anchor = ''
      if (heading.children && heading.children.length > 0 && heading.children[0].type === 'link_open') {
        content = mdRemove(heading.children[1].content)
        anchor = _.kebabCase(content)
      } else {
        content = mdRemove(heading.content)
        anchor = _.kebabCase(heading.children.reduce((acc, t) => acc + t.content, ''))
      }

      tocArray.push({
        content,
        anchor,
        level: +headingclose.tag.substr(1, 1)
      })
    }
  }

  // -> Exclude levels deeper than 2

  _.remove(tocArray, (n) => { return n.level > 3 })

  // -> Build tree from flat array

  return buildTreeFlatArray(tocArray)
}

/**
 * Parse markdown content to HTML
 *
 * @param      {String}    content  Markdown content
 * @return     {String}  HTML formatted content
 */
const parseContent = (content) => {
  let output = mkdown.render(content)
  let cr = cheerio.load(output)

  if (cr.root().children().length < 1) {
    return ''
  }

  // -> Check for empty first element

  let firstElm = cr.root().children().first()[0]
  if (firstElm.type === 'tag' && firstElm.name === 'p') {
    let firstElmChildren = firstElm.children
    if (firstElmChildren.length < 1) {
      firstElm.remove()
    } else if (firstElmChildren.length === 1 && firstElmChildren[0].type === 'tag' && firstElmChildren[0].name === 'img') {
      cr(firstElm).addClass('is-gapless')
    }
  }

  // -> Remove links in headers

  cr('h1 > a:not(.toc-anchor), h2 > a:not(.toc-anchor), h3 > a:not(.toc-anchor)').each((i, elm) => {
    let txtLink = cr(elm).text()
    cr(elm).replaceWith(txtLink)
  })

  // -> Re-attach blockquote styling classes to their parents

  cr.root().children('blockquote').each((i, elm) => {
    if (cr(elm).children().length > 0) {
      let bqLastChild = cr(elm).children().last()[0]
      let bqLastChildClasses = cr(bqLastChild).attr('class')
      if (bqLastChildClasses && bqLastChildClasses.length > 0) {
        cr(bqLastChild).removeAttr('class')
        cr(elm).addClass(bqLastChildClasses)
      }
    }
  })

  // -> Enclose content below headers

  cr('h2').each((i, elm) => {
    let subH2Content = cr(elm).nextUntil('h1, h2')
    cr(elm).after('<div class="indent-h2"></div>')
    let subH2Container = cr(elm).next('.indent-h2')
    _.forEach(subH2Content, (ch) => {
      cr(subH2Container).append(ch)
    })
  })

  cr('h3').each((i, elm) => {
    let subH3Content = cr(elm).nextUntil('h1, h2, h3')
    cr(elm).after('<div class="indent-h3"></div>')
    let subH3Container = cr(elm).next('.indent-h3')
    _.forEach(subH3Content, (ch) => {
      cr(subH3Container).append(ch)
    })
  })

  // Replace video links with embeds

  _.forEach(videoRules, (vrule) => {
    cr(vrule.selector).each((i, elm) => {
      let originLink = cr(elm).attr('href')
      if (vrule.regexp) {
        let vidMatches = originLink.match(vrule.regexp)
        if ((vidMatches && _.isArray(vidMatches))) {
          vidMatches = _.filter(vidMatches, (f) => {
            return f && _.isString(f)
          })
          originLink = _.last(vidMatches)
        }
      }
      let processedLink = _.replace(vrule.output, '{0}', originLink)
      cr(elm).replaceWith(processedLink)
    })
  })

  // Apply align-center to parent

  cr('img.align-center').each((i, elm) => {
    cr(elm).parent().addClass('align-center')
    cr(elm).removeClass('align-center')
  })

  output = cr.html()

  return output
}

/**
 * Parse meta-data tags from content
 *
 * @param      {String}  content  Markdown content
 * @return     {Object}  Properties found in the content and their values
 */
const parseMeta = (content) => {
  let commentMeta = new RegExp('<!-- ?([a-zA-Z]+):(.*)-->', 'g')
  let results = {}
  let match
  while ((match = commentMeta.exec(content)) !== null) {
    results[_.toLower(match[1])] = _.trim(match[2])
  }

  return results
}

/**
 * Strips non-text elements from Markdown content
 *
 * @param      {String}  content  Markdown-formatted content
 * @return     {String}  Text-only version
 */
const removeMarkdown = (content) => {
  return _.join(mdRemove(_.chain(content)
    .replace(/<!-- ?([a-zA-Z]+):(.*)-->/g, '')
    .replace(/```([^`]|`)+?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(new RegExp('(?!mailto:)(?:(?:http|https|ftp)://)(?:\\S+(?::\\S*)?@)?(?:(?:(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}(?:\\.(?:[0-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))|(?:(?:[a-z\\u00a1-\\uffff0-9]+-?)*[a-z\\u00a1-\\uffff0-9]+)(?:\\.(?:[a-z\\u00a1-\\uffff0-9]+-?)*[a-z\\u00a1-\\uffff0-9]+)*(?:\\.(?:[a-z\\u00a1-\\uffff]{2,})))|localhost)(?::\\d{2,5})?(?:(/|\\?|#)[^\\s]*)?', 'g'), '')
    .deburr()
    .toLower()
    .value()
  ).replace(/\r?\n|\r/g, ' ').match(textRegex), ' ')
}

module.exports = {

  /**
   * Parse content and return all data
   *
   * @param      {String}  content  Markdown-formatted content
   * @return     {Object}  Object containing meta, html and tree data
   */
  parse(content) {
    return {
      meta: parseMeta(content),
      html: parseContent(content),
      tree: parseTree(content)
    }
  },

  parseContent,
  parseMeta,
  parseTree,

  removeMarkdown

}
