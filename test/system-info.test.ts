import { describe, it, expect } from 'vitest'
import os from 'node:os'
import type { NicMeta } from '../electron/main/ipc'
import { selectIpv4 } from '../electron/main/ipc'

/*
 * system-info IPv4 选取规则测试.
 * 背景：Windows 上虚拟网卡常被重命名（如 VirtualBox Host-Only 显示为「以太网 2」），
 * 仅凭接口名无法过滤，必须结合网卡驱动描述；同一地址还可能被多个接口重复上报。
 */

function ipv4(address: string, internal = false): os.NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  } as os.NetworkInterfaceInfo
}

function meta(entries: Record<string, Partial<NicMeta>>): Map<string, NicMeta> {
  const map = new Map<string, NicMeta>()
  for (const [name, partial] of Object.entries(entries)) {
    map.set(name.toLowerCase(), {
      description: partial.description ?? '',
      isDefaultRoute: partial.isDefaultRoute ?? false,
    })
  }
  return map
}

describe('selectIpv4', () => {
  it('过滤驱动描述为虚拟网卡但接口名被重命名的适配器（VirtualBox Host-Only）', () => {
    const result = selectIpv4(
      {
        以太网: [ipv4('172.20.20.2')],
        '以太网 2': [ipv4('192.168.56.1')],
      },
      meta({
        以太网: { description: 'Intel(R) Ethernet Connection (17) I219-LM', isDefaultRoute: true },
        '以太网 2': { description: 'VirtualBox Host-Only Ethernet Adapter' },
      }),
    )
    expect(result.list).toEqual(['172.20.20.2'])
    expect(result.primary).toBe('172.20.20.2')
  })

  it('过滤名称/描述含虚拟关键字的网卡（WSL、VMware、Docker、隧道等）', () => {
    const result = selectIpv4({
      'vEthernet (WSL)': [ipv4('172.20.80.1')],
      'VMware Network Adapter VMnet8': [ipv4('192.168.120.1')],
      docker0: [ipv4('172.17.0.1')],
      'Teredo Tunneling Pseudo-Interface': [ipv4('10.0.0.9')],
      以太网: [ipv4('172.20.20.2')],
    })
    expect(result.list).toEqual(['172.20.20.2'])
  })

  it('同一 IPv4 被多个接口上报时只保留一个', () => {
    const result = selectIpv4({
      以太网: [ipv4('172.20.20.2')],
      以太网复制: [ipv4('172.20.20.2')],
    })
    expect(result.list).toEqual(['172.20.20.2'])
  })

  it('排除回环与 APIPA 链路本地地址', () => {
    const result = selectIpv4({
      'Loopback Pseudo-Interface 1': [ipv4('127.0.0.1', true)],
      以太网: [ipv4('169.254.10.20'), ipv4('172.20.20.2')],
    })
    expect(result.list).toEqual(['172.20.20.2'])
  })

  it('主地址取默认路由所在网卡，并排到列表首位', () => {
    const result = selectIpv4(
      {
        以太网: [ipv4('192.168.1.5')],
        WLAN: [ipv4('10.10.1.8')],
      },
      meta({
        以太网: { description: 'Intel(R) Ethernet' },
        WLAN: { description: 'Intel(R) Wi-Fi 6', isDefaultRoute: true },
      }),
    )
    expect(result.primary).toBe('10.10.1.8')
    expect(result.list[0]).toBe('10.10.1.8')
  })

  it('无网卡元数据时退化为按接口名过滤，且取首个可用地址', () => {
    const result = selectIpv4({
      以太网: [ipv4('172.20.20.2')],
      'vEthernet (WSL)': [ipv4('172.20.80.1')],
    })
    expect(result.primary).toBe('172.20.20.2')
    expect(result.list).toEqual(['172.20.20.2'])
  })

  it('无任何可用地址时返回 N/A', () => {
    const result = selectIpv4({ 'vEthernet (WSL)': [ipv4('172.20.80.1')] })
    expect(result.primary).toBe('N/A')
    expect(result.list).toEqual([])
  })
})
