import React, { useState } from 'react'

import { Button, Card, Colors, Flex, Input, Spinner, Text } from '../Components'
import { FC } from '../Services'
import { doLogin } from '../State'

export default function Login({ handleLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setWaiting(true)
    setError('')
    const res = await doLogin({ strategy: 'local', username, password })
    setWaiting(false)
    if (!res) return setError(FC.loginError || 'Login failed, please try again.')
    handleLogin && handleLogin()
  }
  return (
    <Flex fw fh>
      <form>
        <Card fadeIn style={{ padding: 20, maxWidth: 400 }}>
          <Flex fw jb height={error ? 250 : 220}>
            <Text value="EXPO UPDATE SERVER" bold size={28} />

            <Input autofocus autoComplete="username" placeholder="Username" useState={[username, setUsername]} />
            <Input password useState={[password, setPassword]} onEnter={handleSubmit} />
            {error ? <Text value={error} color={Colors.danger} size={13} center /> : null}
            {waiting ? (
              <Spinner />
            ) : (
              <Button label="LOGIN" icon="sign-in-alt" onClick={handleSubmit} style={{ width: '100%' }} />
            )}
          </Flex>
        </Card>
      </form>
    </Flex>
  )
}
