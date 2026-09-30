# 1C ↔ WMS «Русский Лес» — REST API v1

Base URL: `https://rlsklad.ru/api/integration/1c`

## Авторизация

Все внешние методы 1С используют Bearer token:

```http
Authorization: Bearer <ONEC_API_TOKEN>
Content-Type: application/json
```

Токен хранится только в переменной окружения сервера WMS `ONEC_API_TOKEN` и в настройках интеграции 1С.

## Коды складов WMS

| Код | Склад |
|---|---|
| `hardware` | Склад фурнитуры |
| `paint` | Склад краски |
| `ldsp` | Склад ЛДСП |

В каждом документе 1С обязательно передаётся `warehouseCode` — склад WMS, который должен исполнить задание.

---

## 1. Проверка связи

`GET /health`

Пример ответа:

```json
{
  "ok": true,
  "service": "Russian Forest WMS / 1C Integration",
  "version": "v1",
  "warehouses": ["hardware", "paint", "ldsp"]
}
```

---

## 2. Передать документ из 1С в WMS

`POST /orders`

```json
{
  "documentId": "11111111-2222-3333-4444-555555555555",
  "documentNumber": "НФНФ-000875",
  "documentDate": "2026-09-30T10:00:00+05:00",
  "operation": "issue",
  "warehouseCode": "hardware",
  "fromWarehouseCode": "hardware",
  "fromWarehouseId": "1c-guid-source-warehouse",
  "toWarehouseId": "1c-guid-destination",
  "customerOrderId": "1c-guid-order",
  "user": "Купцов Александр",
  "comment": "Выдача в цех",
  "items": [
    {
      "lineId": "line-1-guid",
      "productId": "1c-product-guid",
      "sku": "ABC-001",
      "name": "Болт М6x90",
      "unit": "шт.",
      "quantity": 184
    }
  ]
}
```

Допустимые `operation`:
- `issue` — выдача;
- `transfer` — перемещение.

Успешный ответ: HTTP `201`.

Повторная передача того же `documentId` не создаёт дубль. Если реквизиты совпадают, API возвращает текущий документ с `duplicate: true`. Если `documentId` уже существует, но относится к другому документу/складу/операции — HTTP `409`, `DOCUMENT_ALREADY_EXISTS`.

---

## 3. Получить статус документа

`GET /orders/{documentId}`

Основные статусы:
- `received` — получен WMS;
- `in_progress` — в работе;
- `partial` — частично выдан;
- `waiting_supply` — ожидает пополнения;
- `ready_for_completion` — поступление зарезервировано, готов к довыдаче;
- `completed` — выполнен;
- `cancelled` — отменён.

По каждой строке возвращаются:
- `plannedQuantity`;
- `issuedQuantity`;
- `reservedQuantity`;
- `remainingQuantity`;
- `status`.

---

## 4. Получить фактический результат

`GET /orders/{documentId}/result`

Метод возвращает итог по документу, строки и список фактических операций WMS.

Пример частичного результата:

```json
{
  "ok": true,
  "documentId": "11111111-2222-3333-4444-555555555555",
  "status": "waiting_supply",
  "summary": {
    "plannedQuantity": 184,
    "issuedQuantity": 120,
    "remainingQuantity": 64
  },
  "items": [
    {
      "lineId": "line-1-guid",
      "productId": "1c-product-guid",
      "unit": "шт.",
      "plannedQuantity": 184,
      "issuedQuantity": 120,
      "reservedQuantity": 0,
      "remainingQuantity": 64,
      "status": "waiting_supply"
    }
  ]
}
```

1С должна проводить только фактически выданное количество и не должна повторно проводить уже обработанные операции.

---

## 5. Отмена документа

`POST /orders/{documentId}/cancel`

Отмена разрешена, пока по документу нет фактической выдачи.

Если выдача уже началась, API возвращает HTTP `409` и `DOCUMENT_ALREADY_IN_PROGRESS` — требуется ручное согласование.

---

## Идемпотентность

Обязательные идентификаторы:
- `documentId` — уникальный ID документа 1С;
- `lineId` — ID строки документа;
- `operationId` — уникальный ID фактической операции WMS.

Повторный запрос с тем же идентификатором не должен создавать повторное движение или двойное списание.

---

## Частичная выдача

Пример:

План: 100 шт.  
Фактически доступно: 60 шт.

WMS фиксирует:
- `issuedQuantity = 60`;
- `remainingQuantity = 40`;
- строка/документ получает статус `waiting_supply` после фиксации дефицита.

После поступления 40 шт. они резервируются под незакрытый документ:
- `reservedQuantity = 40`;
- статус `ready_for_completion`.

После довыдачи:
- `issuedQuantity = 100`;
- `remainingQuantity = 0`;
- статус `completed`.

---

## Ошибки

Формат ошибки:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_WAREHOUSE",
    "message": "warehouseCode должен быть hardware, paint или ldsp"
  }
}
```

Основные коды:
- `AUTH_FAILED`
- `API_NOT_CONFIGURED`
- `INVALID_JSON`
- `DOCUMENT_ID_REQUIRED`
- `DOCUMENT_NUMBER_REQUIRED`
- `DOCUMENT_NOT_FOUND`
- `DOCUMENT_ALREADY_EXISTS`
- `DOCUMENT_ALREADY_IN_PROGRESS`
- `DOCUMENT_COMPLETED`
- `DOCUMENT_CLOSED`
- `INVALID_OPERATION`
- `INVALID_WAREHOUSE`
- `INVALID_ITEMS`
- `PRODUCT_ID_REQUIRED`
- `UNIT_REQUIRED`
- `INVALID_QUANTITY`
- `DUPLICATE_LINE_ID`
- `INTERNAL_ERROR`

---

## Внутренний метод WMS

`POST /orders/{documentId}/wms-event`

Этот метод не предназначен для 1С. Он вызывается интерфейсом WMS после реального действия кладовщика и защищён пользовательской сессией WMS.

Поддерживаемые события:
- `start`
- `issue`
- `waiting_supply`
- `reserve`
- `unreserve`

Каждое событие обязано иметь уникальный `operationId`.

---

## Обратная синхронизация в 1С

Текущая версия API уже поддерживает безопасный вариант polling:
1С после передачи документа может читать `GET /orders/{documentId}` и `GET /orders/{documentId}/result`.

Если будет выбран push/callback WMS → 1С, от разработчика 1С дополнительно нужны:
- callback URL;
- способ авторизации callback;
- формат подтверждения успешной обработки.

После получения этих трёх параметров callback добавляется без изменения основного контракта документов.
