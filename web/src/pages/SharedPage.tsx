import { ConfigListPage } from './ConfigListPage'
import { deleteShared, listServices, listShared, putShared } from '../api/config'

export function SharedPage() {
  return (
    <ConfigListPage
      kind="shared"
      list={listShared}
      // 公共配置编辑时展示"将热推送至全部 N 个服务"的影响面
      listServiceNames={async () => (await listServices()).map((s) => s.key)}
      save={putShared}
      remove={deleteShared}
    />
  )
}
