import { ConfigListPage } from './ConfigListPage'
import { deleteService, listServices, previewService, putService } from '../api/config'

export function ServicesPage() {
  return (
    <ConfigListPage
      kind="services"
      list={listServices}
      save={putService}
      remove={deleteService}
      preview={previewService}
    />
  )
}
