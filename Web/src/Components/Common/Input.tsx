import React, { useRef, useEffect } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { Password } from 'primereact/password'
import type { PasswordProps } from 'primereact/password'
import { InputText } from 'primereact/inputtext'
import type { InputTextProps } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import type { InputTextareaProps } from 'primereact/inputtextarea'
import { Calendar } from 'primereact/calendar'
import type { CalendarProps } from 'primereact/calendar'
import { Dropdown } from 'primereact/dropdown'
import type { DropdownProps } from 'primereact/dropdown'
import { locale, addLocale } from 'primereact/api'
import moment from 'moment'

import { Flex, Text, Colors } from '..'
import type { InputProps } from '../../types'

type MutableInputProps = InputProps & {
  ref?: RefObject<unknown>
  className?: string
  onChange?: (event: { target: { value: unknown; id?: string } }) => void
  onKeyDown?: (event: { keyCode: number }) => void | Promise<void>
  inputStyle?: CSSProperties
  feedback?: boolean
  placeholder?: string
  autoResize?: boolean
  rows?: number
  yearRange?: string
  showIcon?: boolean
  dateFormat?: string
  readOnlyInput?: boolean
  options?: DropdownProps['options']
}

type PrimeInputProps = Partial<PasswordProps & InputTextProps & InputTextareaProps & CalendarProps & DropdownProps>

export const Input = ({
  setRef, setValue, useState, onChange, onEnter,
  autofocus, password, date, label, multiline, dropdown,
  autoComplete, error, ...restProps
}: InputProps) => {
  const inputRef = useRef(null)
  setRef && setRef(inputRef)
  const props = restProps as MutableInputProps
  props.ref = inputRef
  useEffect(() => {
    autofocus && setTimeout(() => {
      if (!inputRef || !inputRef.current) return false
      const current = inputRef.current as { element?: { focus: () => void }; inputEl?: { focus: () => void } } | null
      current?.element?.focus()
      current?.inputEl?.focus()
    }, 500)
  }, [autofocus])

  error && (props.className = 'invalid-input')

  if (onChange && !props.id) throw new Error('Missing ID for OnChange')

  props.value === undefined && (props.value = '')
  useState && useState.length === 2 && (props.value = useState[0])

  useState && useState.length === 2 && (props.onChange = (e) => useState[1](String(e.target.value ?? '')))
  setValue && (props.onChange = (e) => setValue(String(e.target.value ?? '')))
  onChange && (props.onChange = (e) => onChange({ [e.target.id || 'value']: e.target.value }))
  onEnter && (props.onKeyDown = (key) => key.keyCode === 13 && onEnter())
  useState && onChange && (props.onChange = (e) => {
    const value = String(e.target.value ?? '')
    useState[1](value)
    onChange(value)
  })

  props.autoComplete = autoComplete || 'off'

  props.style = {
    borderRadius: 8,
    paddingLeft: 12,
    width: '100%',
    backgroundColor: Colors.secondary,
    border: '1px solid rgba(255,255,255,.125)',
    color: Colors.inputText,
    ...props.style
  }

  if (password) {
    props.autoComplete = 'current-password'
    props.placeholder = 'Password'
    props.feedback = false
    const containerStyle = extractStyle(props)
    props.inputStyle = { ...props.style, width: '100%' }
    props.style = containerStyle
    return <Password {...toPrimeProps(props)} />
  }

  if (date) {
    props.yearRange = `2015:${moment().format('YYYY')}`
    props.showIcon = false
    props.dateFormat = 'dd/mm/yy'
    props.readOnlyInput = true
    props.inputStyle = {
      paddingLeft: 12,
      borderRadius: 20,
      border: 'none'
    }
    const containerStyle = extractStyle(props)
    props.style.width = props.style.textWidth || '50%'
    props.style.flexGrow = 1
    props.style.marginLeft = 5
    return (
      <Flex row js style={{ backgroundColor: 'rgba(30,37,47)', paddingLeft: 12, borderRadius: 20, ...containerStyle }}>
        <Text value={label} color='white' />
        <Calendar {...toPrimeProps(props)} value={new Date(String(props.value))} />
      </Flex>
    )
  }

  if (multiline) {
    props.autoResize === undefined && (props.autoResize = true)
    props.style.height = '100%'
    props.style.padding = 15
    return <InputTextarea {...toPrimeProps(props)} />
  }

  if (dropdown) return <Dropdown {...toPrimeProps(props)} />

  if (label) {
    const containerStyle = extractStyle(props)
    props.style.width = props.style.textWidth || '50%'
    props.style.flexGrow = 1
    props.style.marginLeft = 5
    return (
      <Flex row js style={{ backgroundColor: 'rgba(30,37,47)', paddingLeft: 12, borderRadius: 20, ...containerStyle }}>
        <Text value={label} color='white' />
        <InputText {...toPrimeProps(props)} />
      </Flex>
    )
  }

  return <InputText {...toPrimeProps(props)} />
}

const toPrimeProps = (props: MutableInputProps): PrimeInputProps => props as PrimeInputProps

const extractStyle = (props: MutableInputProps) => {
  const { width, height, marginTop, marginBottom, marginLeft, marginRight, ...otherStyles } = props.style
  props.style = otherStyles
  return { width, height, marginTop, marginBottom, marginLeft, marginRight }
}

addLocale('it', {
  firstDayOfWeek: 1,
  dayNames: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'],
  dayNamesShort: ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'],
  dayNamesMin: ['D', 'L', 'Ma', 'Me', 'G', 'V', 'S'],
  monthNames: [
    'Gennaio',
    'Febbraio',
    'Marzo',
    'Aprile',
    'Maggio',
    'Giugno',
    'Luglio',
    'Agosto',
    'Settembre',
    'Ottobre',
    'Novembre',
    'Dicembre'
  ],
  monthNamesShort: ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
}
)
locale('it')
