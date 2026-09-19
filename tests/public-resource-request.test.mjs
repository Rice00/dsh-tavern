import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { isPublicResourceAddress, verifyPublicResourceUrl, createPublicResourceRequest } from '../tavern-plugin/lib/domain/public-resource-request.js'
test('私网、回环、映射 IPv6、保留地址被拒绝，公共 IPv4/IPv6 可用', () => {
  for (const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2002:7f00:1::','2001:db8::1']) assert.equal(isPublicResourceAddress(address), false, address)
  for (const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(isPublicResourceAddress(address), true, address)
  for (const url of ['https://127.1/a','https://[::1]/a','https://localhost./a','https://x.localhost/a']) assert.throws(() => verifyPublicResourceUrl(url))
})
test('在 socket 使用的 DNS 查询处阻止内网答案及混合答案', async () => {
  for (const addresses of [[], [{ address: '127.0.0.1', family: 4 }], [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]]) {
    let connected = false
    const request = createPublicResourceRequest({ resolve: async () => addresses, request: (_url, options) => {
      const req = new EventEmitter()
      req.end = () => options.lookup('example.com', { all: true }, error => { if (error) req.emit('error', error); else connected = true })
      return req
    } })
    await assert.rejects(request('https://example.com/a'), /内网或保留/)
    assert.equal(connected, false)
  }
})

test('公共地址响应可正常读取，实际响应字节超过上限会中止', async () => {
  const { Readable } = await import('node:stream')
  for (const maxBytes of [2, 10]) {
    let connected
    const request = createPublicResourceRequest({ maxBytes, resolve: async () => [{ address: '8.8.8.8', family: 4 }], request: (_url, options, respond) => {
      const req = new EventEmitter()
      req.end = () => options.lookup('example.com', { all: true }, (error, addresses) => {
        if (error) return req.emit('error', error)
        connected = addresses
        const stream = Readable.from([Buffer.from('hello')])
        stream.statusCode = 200; stream.headers = { 'content-type': 'text/plain' }
        respond(stream)
      })
      return req
    } })
    const response = await request('https://example.com/a')
    assert.deepEqual(connected, [{ address: '8.8.8.8', family: 4 }])
    if (maxBytes === 2) await assert.rejects(response.arrayBuffer(), /超过/)
    else assert.equal((await response.arrayBuffer()).toString(), 'hello')
  }
})
