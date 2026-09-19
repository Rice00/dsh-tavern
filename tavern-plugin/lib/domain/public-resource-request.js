import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'

const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['192.0.2.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
blocked.addSubnet('2001::', 23, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6')
blocked.addSubnet('2001:db8::', 32, 'ipv6')
export function isPublicResourceAddress(address) {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}
export function verifyPublicResourceUrl(url) {
  const parsed = new URL(url), host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !isPublicResourceAddress(host))) throw new Error('静态资源只允许公共 HTTPS 地址')
}

// Validate the address used by the socket itself, preventing DNS rebinding.
export function createPublicResourceRequest({ resolve = lookup, request = httpsRequest, maxBytes = 64 * 1024 * 1024 } = {}) {
  return async function fetchResource(url, options = {}) {
    verifyPublicResourceUrl(url)
    return new Promise((accept, reject) => {
      const req = request(url, { headers: options.headers, signal: options.signal,
        lookup(host, opts, callback) {
          resolve(host, { all: true }).then(addresses => {
            if (!addresses.length || addresses.some(item => !isPublicResourceAddress(item.address))) throw new Error('拒绝静态资源的内网或保留地址')
            const first = addresses[0]
            if (opts.all) callback(null, [first]); else callback(null, first.address, first.family)
          }).catch(callback)
        }
      }, response => {
        const status = response.statusCode || 0, headers = new Headers()
        for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
        if (status < 200 || status >= 300) response.resume()
        accept({ status, ok: status >= 200 && status < 300, headers, url,
          async arrayBuffer() {
            let size = 0; const chunks = []
            for await (const chunk of response) {
              size += chunk.length
              if (size > maxBytes) { response.destroy(); throw new Error('静态资源超过单文件缓存上限') }
              chunks.push(Buffer.from(chunk))
            }
            return Buffer.concat(chunks)
          }
        })
      })
      req.on('error', reject)
      req.end()
    })
  }
}
