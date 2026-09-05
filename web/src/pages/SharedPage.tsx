import { ConfigListPage } from './ConfigListPage'
import { deleteShared, listShared, putShared } from '../api/config'

export function SharedPage() {
  return (
    <ConfigListPage
      kind="shared"
      list={listShared}
      save={putShared}
      remove={deleteShared}
    />
  )
}
