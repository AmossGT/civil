import { useCallback, useEffect, useRef, useState } from 'react'
import { findAboutDefinition } from './aboutGlossary.js'
import './assistant.css'

const commonQuestions = [
  'What is RoadSathi?',
  'How do I search for tenders?',
  'How can I explore Map View?',
  'How do I view tender details?',
  'Where can I find work orders and documents?',
  'How can I contact the relevant authorities?',
]

const pageQuestions = {
  Overview: ['What is RoadSathi?', 'How do I search for tenders?', 'How can I explore Map View?'],
  Tenders: ['How do I search for tenders?', 'How do I filter or sort tenders?', 'How do I view tender details?', 'Where can I find work orders and documents?'],
  'Map View': ['How can I explore Map View?', 'How do I select a road?', 'Why might a road have no linked tender?'],
  'About Us': ['What is RoadSathi?', 'What information does RoadSathi show?', 'How can I contact the relevant authorities?'],
}

const pageHints = {
  Overview: 'You’re on Overview. It brings together public summaries, recent tender activity, and links to the tender list and project map.',
  Tenders: 'You’re on Tenders. Search by project, tender ID, or department; filter and sort the results; then choose View Details.',
  'Map View': 'You’re on Map View. Select a plotted road or project marker to see its linked records and available details beside the map.',
  'About Us': 'You’re on About. This page describes RoadSathi’s purpose and the public information presented on the portal.',
}

const intents = [
  {
    id: 'general', score: text => (/what is|what's|tell me about|purpose|why was/i.test(text) && /roadsathi|portal|website|platform|transparen/i.test(text) ? 5 : 0) + (/what is roadsathi/i.test(text) ? 3 : 0),
    answer: 'RoadSathi is a public infrastructure transparency portal that brings published road project and tender information together so people can explore records, awards, and available documents.',
  },
  {
    id: 'search', score: text => (/search|find|locate|look up|look for|browse/i.test(text) ? 2 : 0) + (/tender|project|contract/i.test(text) ? 2 : 0) + (/how|where|steps|start/i.test(text) ? 1 : 0),
    answer: 'To find a tender, open Tenders and search by project name, tender ID, or department. Then review the matching records. Department and project-status filters and the Sort By menu can narrow and reorder the list. Choose View Details to open a record.', action: ['Tenders', 'Open Tenders'],
  },
  {
    id: 'filter-sort', score: text => (/filter|sort|order|newest|oldest|low to high|high to low/i.test(text) ? 4 : 0) + (/tender|record|department|status|date|value/i.test(text) ? 2 : 0),
    answer: 'On Tenders, use the department and project-status controls to filter records. Sort By changes the order of the filtered results, including available name, awarded-value, or date options.', action: ['Tenders', 'Open Tenders'],
  },
  {
    id: 'details', score: text => (/detail|information|record|view|see|open/i.test(text) ? 2 : 0) + (/tender|project|contract/i.test(text) ? 2 : 0) + (/its|their|that|this|selected/i.test(text) ? 1 : 0),
    answer: 'Find the record in Tenders and select its View Details button. The detail view shows the project and tender fields, award and contractor information, and any supporting documents available for that record.', action: ['Tenders', 'Open Tenders'],
  },
  {
    id: 'work-order', score: text => (/work order|workorder|order to start|commencement/i.test(text) ? 6 : 0),
    answer: 'Open the relevant tender with View Details and look in Documents & Route Plans for a work order. It will be available to open or download when the record includes one.', action: ['Tenders', 'Open Tenders'],
  },
  {
    id: 'documents', score: text => (/document|pdf|kmz|route plan|map layout|download|attachment|file/i.test(text) ? 3 : 0) + (/where|find|open|view|download/i.test(text) ? 1 : 0),
    answer: 'Open the relevant tender using View Details and go to Documents & Route Plans. Available PDFs, KMZ route plans, work orders, map layouts, and instructions stay grouped with their record. A file is downloadable when it is provided there.', action: ['Tenders', 'Open Tenders'],
  },
  {
    id: 'map', score: text => (/map view|map|geograph|checkpoint|marker|select a road|road selection/i.test(text) ? 4 : 0) + (/project|road|tender|find|explore|work/i.test(text) ? 1 : 0),
    answer: 'Map View lets you explore available road features and project points geographically. Select a road or marker to highlight it and show its available project and linked tender details in the side panel. Some records have no plot-ready map data; the page identifies those cases.', action: ['Map View', 'Open Map View'],
  },
  {
    id: 'road-projects', score: text => (/road project|project location|road location|route on map|road on map/i.test(text) ? 5 : 0) + (/where|show|select|find/i.test(text) ? 1 : 0),
    answer: 'Use Map View to inspect projects that have available coordinates or road geometry. Selecting a plotted feature highlights it and displays the project information the record provides. Records without map data remain accessible from Tenders.', action: ['Map View', 'Open Map View'],
  },
  {
    id: 'contractor', score: text => (/contractor|contractor name|who built|who is building|implementing agency/i.test(text) ? 5 : 0) + (/contact|name|who|details/i.test(text) ? 1 : 0),
    answer: 'A contractor’s name or other available contractor details appear in the corresponding tender’s View Details record. RoadSathi only shows details present in the published record.', action: ['Tenders', 'Open Tenders'],
  },
  {
    id: 'contact', score: text => (/contact|phone|email|address|complaint|reach/i.test(text) ? 3 : 0) + (/authority|department|contractor|official|someone/i.test(text) ? 2 : 0),
    answer: 'Check the relevant tender or project details for department, authority, or contractor contact information. RoadSathi does not provide contact details that are absent from the published record.', action: ['Tenders', 'Open Tenders'],
  },
  {
    id: 'about', score: text => (/about|transparency|how roadsathi works|what information/i.test(text) ? 4 : 0),
    answer: 'RoadSathi presents public road procurement information, including tender and project records, award details, and supporting documents where they are available. The About page explains the portal’s purpose.', action: ['About Us', 'Open About'],
  },
  {
    id: 'navigation', score: text => (/go to|open the|navigate|which page|where is/i.test(text) ? 2 : 0) + (/overview|tenders|map|about/i.test(text) ? 2 : 0),
    answer: null,
  },
]

const pagePrompts = {
  Overview: 'Would you like a quick tour of RoadSathi?',
  Tenders: 'Looking for a tender? I can show you how to search and explore tender details!',
  'Map View': 'Need help finding a road project on the map?',
  'About Us': 'Want to know more about how RoadSathi works?',
}

function getIntent(text, previousIntent) {
  const normalized = text.trim().toLowerCase()
  const referential = /\b(it|its|that|this|those|them|there|also)\b/.test(normalized)
  const isFollowUp = /\b(what about|and|then|how about|where do i see)\b/.test(normalized)
  const scored = intents.map(intent => ({ intent, score: intent.score(normalized) })).sort((a, b) => b.score - a.score)
  if (scored[0]?.score > 0) return scored[0].intent
  if ((referential || isFollowUp) && previousIntent) {
    if (/\b(detail|details|information)\b/.test(normalized)) return intents.find(item => item.id === 'details')
    if (/\b(document|file|work order|kmz|pdf)\b/.test(normalized)) return intents.find(item => /work order|kmz|pdf/i.test(normalized) ? item.id === 'work-order' : item.id === 'documents')
    if (previousIntent === 'search') return intents.find(item => item.id === 'details')
    return intents.find(item => item.id === previousIntent)
  }
  if (/\b(overview|tenders|map|about)\b/.test(normalized)) return intents.find(item => item.id === 'navigation')
  return null
}

function getAnswer(intent, question, page) {
  if (intent.id === 'navigation') {
    const target = /\bmap\b/i.test(question) ? ['Map View', 'Open Map View'] : /\babout\b/i.test(question) ? ['About Us', 'Open About'] : /\btender/i.test(question) ? ['Tenders', 'Open Tenders'] : ['Overview', 'Open Overview']
    return { text: `You can open ${target[0]} from the main navigation at the top of the page.`, action: target }
  }
  if (intent.id === 'search' && /\b(its|their|that|this)\b/.test(question.toLowerCase())) {
    return { text: 'Once you have the matching record, select View Details on that tender to open its available project information and documents.', action: ['Tenders', 'Open Tenders'] }
  }
  if (intent.id === 'map' && /\b(no|not|without|missing|unlinked|matching)\b/i.test(question)) {
    return { text: 'A road can be shown without a linked tender when map geometry or project data is available but the tender match is missing. The Map View side panel reports that no registered tender is linked and still shows any road information it has.', action: ['Map View', 'Open Map View'] }
  }
  return { text: intent.answer || pageHints[page] || 'I can help with RoadSathi’s public tender and project information.', action: intent.action }
}

function AssistantIcon({ name, size = 18 }) {
  const paths = {
    close: <path d="m6 6 12 12M18 6 6 18" />,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    chat: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

export default function RoadSathiAssistant({ page, navigate }) {
  const [open, setOpen] = useState(false)
  const [bubble, setBubble] = useState(false)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const [showQuestions, setShowQuestions] = useState(true)
  const [idleCue, setIdleCue] = useState(false)
  const [blinking, setBlinking] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const triggerRef = useRef(null)
  const idleTimerRef = useRef(null)
  const bubbleTimerRef = useRef(null)
  const focusOutTimerRef = useRef(null)
  const bubbleVisibleRef = useRef(false)
  const responseTimerRef = useRef(null)
  const blinkTimerRef = useRef(null)
  const blinkDelayRef = useRef(null)
  const blinkNowRef = useRef(null)
  const cooldownUntilRef = useRef(0)
  const processingRef = useRef(false)
  const messageIdRef = useRef(0)
  const previousIntentRef = useRef(null)
  const previousQuestionRef = useRef('')
  const messagesRef = useRef([])

  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    const openEyes = new Image()
    const closedEyes = new Image()
    openEyes.src = '/roadsathi-mascot-open.webp'
    closedEyes.src = '/roadsathi-mascot-blink.svg'
  }, [])

  const blink = useCallback(() => {
    if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    window.clearTimeout(blinkTimerRef.current)
    setBlinking(true)
    blinkTimerRef.current = window.setTimeout(() => setBlinking(false), 190)
  }, [])
  useEffect(() => { blinkNowRef.current = blink }, [blink])

  useEffect(() => {
    let stopped = false
    const clearBlinkDelay = () => window.clearTimeout(blinkDelayRef.current)
    const scheduleBlink = () => {
      clearBlinkDelay()
      if (stopped || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      blinkDelayRef.current = window.setTimeout(() => {
        blinkNowRef.current?.()
        scheduleBlink()
      }, 4000 + Math.random() * 2000)
    }
    const handleVisibility = () => {
      if (document.hidden) {
        clearBlinkDelay()
        window.clearTimeout(blinkTimerRef.current)
        setBlinking(false)
      } else if (!open) scheduleBlink()
    }
    if (open) {
      clearBlinkDelay()
    } else scheduleBlink()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stopped = true
      clearBlinkDelay()
      window.clearTimeout(blinkTimerRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [open])

  const hideBubble = useCallback(({ applyCooldown = false } = {}) => {
    window.clearTimeout(bubbleTimerRef.current)
    bubbleVisibleRef.current = false
    setBubble(false)
    setIdleCue(false)
    if (applyCooldown) cooldownUntilRef.current = Date.now() + 120_000
  }, [])

  useEffect(() => {
    if (open) return undefined
    const armIdleTimer = () => {
      window.clearTimeout(idleTimerRef.current)
      if (document.hidden) return
      if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return
      idleTimerRef.current = window.setTimeout(() => {
        if (open || document.hidden || Date.now() < cooldownUntilRef.current) return
        cooldownUntilRef.current = Date.now() + 120_000
        setIdleCue(true)
        blinkNowRef.current?.()
        bubbleVisibleRef.current = true
        setBubble(true)
        bubbleTimerRef.current = window.setTimeout(() => hideBubble(), 8_000)
      }, 45_000)
    }
    const handleActivity = () => {
      if (bubbleVisibleRef.current) hideBubble()
      armIdleTimer()
    }
    const handleFocusOut = () => {
      window.clearTimeout(focusOutTimerRef.current)
      focusOutTimerRef.current = window.setTimeout(armIdleTimer, 0)
    }
    const handleVisibility = () => {
      if (document.hidden) window.clearTimeout(idleTimerRef.current)
      else armIdleTimer()
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'input', 'touchstart', 'focusin']
    events.forEach(event => window.addEventListener(event, handleActivity, { passive: event === 'scroll' || event === 'touchstart' }))
    window.addEventListener('focusout', handleFocusOut)
    document.addEventListener('visibilitychange', handleVisibility)
    armIdleTimer()
    return () => {
      window.clearTimeout(idleTimerRef.current)
      window.clearTimeout(bubbleTimerRef.current)
      window.clearTimeout(focusOutTimerRef.current)
      events.forEach(event => window.removeEventListener(event, handleActivity))
      window.removeEventListener('focusout', handleFocusOut)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [open, page, hideBubble])

  useEffect(() => () => window.clearTimeout(responseTimerRef.current), [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing, showQuestions])

  useEffect(() => {
    if (!open) return undefined
    const handleKey = event => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  const show = () => {
    hideBubble()
    setOpen(true)
  }

  const ask = useCallback(text => {
    const question = text.trim()
    if (!question || processingRef.current) return
    processingRef.current = true
    setDraft('')
    setShowQuestions(false)
    const definition = findAboutDefinition(question)
    const intent = definition ? null : getIntent(question, previousIntentRef.current)
    const userMessage = { id: ++messageIdRef.current, from: 'user', text: question }
    setMessages(current => [...current, userMessage])
    setTyping(true)
    responseTimerRef.current = window.setTimeout(() => {
      let answer
      if (definition) {
        answer = { text: definition.definition }
      } else if (!intent) {
        answer = { text: 'I’m not completely sure what you mean. Could you rephrase that or choose one of the topics below?' }
      } else {
        answer = getAnswer(intent, question, page)
        const lastAssistant = [...messagesRef.current].reverse().find(message => message.from === 'assistant')
        const repeatedDifferentQuestion = lastAssistant?.text === answer.text && previousQuestionRef.current.toLowerCase() !== question.toLowerCase()
        if (repeatedDifferentQuestion) answer = { ...answer, text: `For ${intent.id.replace('-', ' ')}: ${answer.text}` }
      }
      previousIntentRef.current = definition ? 'about-definition' : intent?.id || previousIntentRef.current
      const assistantMessage = { id: ++messageIdRef.current, from: 'assistant', text: answer.text, action: answer.action }
      setMessages(current => [...current, assistantMessage])
      messagesRef.current = [...messagesRef.current, userMessage, assistantMessage]
      previousQuestionRef.current = question
      setTyping(false)
      processingRef.current = false
    }, 380)
  }, [page])

  const questions = pageQuestions[page] || commonQuestions
  const handleDismiss = () => hideBubble({ applyCooldown: true })

  return <div className="roadsathi-guide-widget">
    {open && <section className="guide-panel" role="dialog" aria-modal="false" aria-labelledby="guide-title">
      <header className="guide-header">
        <img src="/roadsathi-mascot-open.webp" alt="" className="guide-header-mascot" />
        <div className="guide-header-copy"><strong id="guide-title">RoadSathi Guide</strong><span><i /> Here to help you explore</span></div>
        <button className="guide-close" type="button" aria-label="Close RoadSathi Guide" onClick={() => { setOpen(false); triggerRef.current?.focus() }}><AssistantIcon name="close" /></button>
      </header>
      <div className="guide-messages" ref={scrollRef} role="log" aria-live="polite" aria-label="Conversation">
        <div className="guide-message guide-message-assistant"><p>Hello! Welcome to RoadSathi. I’m here to help you understand public road projects, explore tenders, and find useful information. What would you like to know?</p></div>
        <div className="guide-context"><span className="guide-context-label">{page || 'RoadSathi'}</span>{pageHints[page] || 'Choose a question below, or ask about public information on RoadSathi.'}</div>
        {messages.map(message => <div className={`guide-message guide-message-${message.from}`} key={message.id}>
          <p>{message.text}</p>
          {message.action && <button className="guide-action" type="button" onClick={() => { navigate(message.action[0]); setOpen(false) }}>{message.action[1]} <span aria-hidden="true">→</span></button>}
        </div>)}
        {typing && <div className="guide-message guide-message-assistant guide-typing" aria-label="RoadSathi Guide is preparing a response"><span /><span /><span /></div>}
      </div>
      <div className="guide-suggestions">
        <button className="guide-suggestions-toggle" type="button" aria-expanded={showQuestions} onClick={() => setShowQuestions(value => !value)}>{showQuestions ? 'Hide suggestions' : 'Suggested questions'} <span aria-hidden="true">{showQuestions ? '−' : '+'}</span></button>
        {showQuestions && <div className="guide-suggestion-list">{questions.map(question => <button type="button" key={question} disabled={typing} onClick={() => ask(question)}>{question}<span aria-hidden="true">›</span></button>)}</div>}
      </div>
      <form className="guide-input-row" onSubmit={event => { event.preventDefault(); ask(draft) }}>
        <label className="guide-sr-only" htmlFor="guide-message-input">Ask RoadSathi Guide</label>
        <input ref={inputRef} id="guide-message-input" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask a question…" autoComplete="off" />
        <button type="submit" aria-label="Send message" disabled={!draft.trim() || typing}><AssistantIcon name="send" size={17} /></button>
      </form>
      <div className="guide-disclaimer">Answers are based on features and information available on this portal.</div>
    </section>}
    {!open && <div className={`guide-greeting ${bubble ? 'is-idle-message' : ''}`} role="status">
      <strong>Need help?</strong>
      <button className="guide-greeting-open" type="button" onClick={show}>Ask me <span aria-hidden="true">→</span></button>
      {bubble && <><span>{pagePrompts[page] || 'Would you like help exploring RoadSathi?'}</span><button className="guide-greeting-dismiss" type="button" aria-label="Dismiss help prompt" onClick={handleDismiss}><AssistantIcon name="close" size={14} /></button></>}
      <i aria-hidden="true" />
    </div>}
    <button ref={triggerRef} className={`guide-mascot-trigger ${open ? 'is-open' : ''} ${idleCue && !open ? 'is-idle-cue' : ''}`} type="button" onClick={() => open ? setOpen(false) : show()} aria-label={open ? 'Close RoadSathi Guide' : 'Open RoadSathi Guide'} aria-expanded={open}>
      <img src={blinking ? '/roadsathi-mascot-blink.svg' : '/roadsathi-mascot-open.webp'} alt="" />
      {!open && <span className="guide-notification" aria-hidden="true"><AssistantIcon name="chat" size={13} /></span>}
    </button>
  </div>
}
