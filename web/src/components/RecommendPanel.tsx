import { useEffect, useState } from 'react'
import { RocketIcon } from 'lucide-react'
import { recommendNode, type RecommendNode, type RecommendRes } from '../api/deploy'
import { formatGB, pctOfReported, pctOfUsed } from '../utils/metrics'
import { EmptyState } from './EmptyState'
import { InlineAlert } from './InlineAlert'
import { Meter } from './Meter'
import { Panel } from './Panel'
import { ToneBadge } from './ToneBadge'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

export function RecommendPanel({
  artifactId,
  hostPort,
  onDeploy,
}: {
  artifactId?: number
  hostPort?: number
  onDeploy: (nodeIds: string[], remark?: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<RecommendRes | null>(null)

  useEffect(() => {
    if (!artifactId) {
      setData(null)
      setError('')
      return
    }
    let stop = false
    setData(null)
    setError('')
    const load = async () => {
      setLoading(true)
      try {
        const res = await recommendNode(artifactId, hostPort)
        if (!stop) {
          setData(res)
          setError('')
        }
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : '推荐失败')
      } finally {
        if (!stop) setLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 8000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [artifactId, hostPort])

  if (!artifactId) {
    return (
      <InlineAlert
        tone="info"
        title="选择产物后显示推荐节点"
        description="按各节点剩余内存和 CPU 打分，并逐台说明不适合的原因。确认后再下发，不会自动部署。"
      />
    )
  }

  return (
    <Panel
      title="节点推荐"
      actions={<span className="text-muted-foreground text-xs">每 8 秒重新打分</span>}
      bodyClassName="px-0 py-0"
      loading={loading && !data}
    >
      {error ? (
        <div className="px-4 py-3 sm:px-5">
          <InlineAlert tone="danger" title={error} />
        </div>
      ) : null}

      {data ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <p className="text-muted-foreground min-w-0 flex-1 text-[13px] leading-5">{data.summary}</p>
            <Button size="sm" disabled={!data.recommendedNodeId} onClick={() => onDeploy([data.recommendedNodeId], `推荐节点 ${data.recommendedNodeId}`)}>
              <RocketIcon />
              部署到推荐节点
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-40 pl-4">节点</TableHead>
                <TableHead className="w-40">CPU</TableHead>
                <TableHead className="w-48">内存</TableHead>
                <TableHead className="w-16 text-right">容器</TableHead>
                <TableHead className="w-16 text-right">空闲分</TableHead>
                <TableHead>原因</TableHead>
                <TableHead className="w-28 pr-4 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.nodes.map((node: RecommendNode) => {
                const cpuPercent = pctOfReported(node.cpuUsedPercent)
                const memoryPercent = pctOfUsed(node.memoryUsedBytes, node.memoryBytes)
                return (
                  <TableRow key={node.nodeId}>
                    <TableCell className="pl-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-medium">{node.nodeId}</span>
                        {node.recommended ? (
                          <span>
                            <ToneBadge tone="success">推荐</ToneBadge>
                          </span>
                        ) : node.eligible ? null : (
                          <span>
                            <ToneBadge tone="neutral">不可部署</ToneBadge>
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Meter
                        caption={cpuPercent == null ? `${node.ncpu || '-'} 核` : `${cpuPercent}% · ${node.ncpu} 核`}
                        percent={cpuPercent}
                        minWidth={120}
                      />
                    </TableCell>
                    <TableCell>
                      {node.memoryBytes ? (
                        <Meter
                          caption={
                            memoryPercent == null
                              ? `— / ${formatGB(node.memoryBytes)}`
                              : `${formatGB(node.memoryUsedBytes ?? 0)} / ${formatGB(node.memoryBytes)}`
                          }
                          percent={memoryPercent}
                          minWidth={150}
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{node.containerCount}</TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">
                      {node.eligible ? node.score : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-0 truncate text-xs" title={node.reason}>
                      {node.reason}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {node.eligible && !node.recommended ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => onDeploy([node.nodeId], `选择节点 ${node.nodeId}`)}
                        >
                          部署到此节点
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
              {data.nodes.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <EmptyState title="没有可选节点" hint="等待 deploy-agent 上报心跳后重新打分。" />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      ) : loading ? (
        <div className="space-y-2 px-4 py-4 sm:px-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : null}
    </Panel>
  )
}
