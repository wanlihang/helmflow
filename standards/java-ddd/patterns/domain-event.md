# Domain Event Pattern

> When to use: Define a Domain Event when a state change in one aggregate needs to trigger actions in other aggregates or external systems. Events decouple producers from consumers, enabling cross-aggregate consistency without direct coupling.

## Domain Event Interface (Domain Layer)

```java
package {PACKAGE}.domain.event;

import java.util.Date;

/**
 * Base interface for all domain events.
 * Defined in the domain layer, implemented by specific events.
 */
public interface DomainEvent {

    /**
     * When this event occurred.
     */
    Date getOccurredOn();
}
```

## Domain Event Publisher Interface (Domain Layer)

```java
package {PACKAGE}.domain.event;

/**
 * Domain event publisher interface — defined in domain layer.
 * Implementation lives in infrastructure layer (dependency inversion).
 */
public interface DomainEventPublisher {

    /**
     * Publish a domain event to all registered listeners.
     */
    void publish(DomainEvent event);
}
```

## Concrete Domain Event

```java
package {PACKAGE}.domain.{MODULE}.model.event;

import {PACKAGE}.domain.event.DomainEvent;
import lombok.Getter;
import java.util.Date;

/**
 * Event fired when a {Business} status changes.
 */
@Getter
public class {Business}StatusChangedEvent implements DomainEvent {

    private final Long {business}Id;
    private final String fromStatus;
    private final String toStatus;
    private final Date occurredOn;

    public {Business}StatusChangedEvent(Long {business}Id, String fromStatus, String toStatus) {
        this.{business}Id = {business}Id;
        this.fromStatus = fromStatus;
        this.toStatus = toStatus;
        this.occurredOn = new Date();
    }

    @Override
    public Date getOccurredOn() {
        return this.occurredOn;
    }
}
```

## Spring Domain Event Publisher (Infrastructure Layer)

```java
package {PACKAGE}.infrastructure.event;

import {PACKAGE}.domain.event.DomainEvent;
import {PACKAGE}.domain.event.DomainEventPublisher;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * Domain event publisher implementation using Spring's event mechanism.
 */
@Slf4j
@Component
public class SpringDomainEventPublisher implements DomainEventPublisher {

    @Autowired
    private ApplicationEventPublisher applicationEventPublisher;

    @Override
    public void publish(DomainEvent event) {
        log.info("BIZ-SERVICE-LOGGER|DomainEventPublished|type={}|occurredOn={}",
            event.getClass().getSimpleName(), event.getOccurredOn());
        applicationEventPublisher.publishEvent(event);
    }
}
```

## Event Listener (Application Layer)

```java
package {PACKAGE}.application.{MODULE}.handler;

import {PACKAGE}.domain.{MODULE}.model.event.{Business}StatusChangedEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Listener for {Business} status change events.
 * Lives in the application layer.
 */
@Slf4j
@Component
public class {Business}StatusChangedHandler {

    @EventListener
    public void on{Business}StatusChanged({Business}StatusChangedEvent event) {
        log.info("BIZ-SERVICE-LOGGER|{Business}StatusChanged|id={}|from={}|to={}",
            event.get{Business}Id(), event.getFromStatus(), event.getToStatus());
        // Handle status change: notify downstream, update related aggregates, etc.
    }
}
```

## Usage in Aggregate

```java
// Inside an aggregate method, after state transition:
public void complete() {
    if (this.status != {Business}StatusEnum.PROCESSING) {
        throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
            "Cannot complete from status: " + this.status.getCode());
    }
    String fromStatus = this.status.getCode();
    this.status = {Business}StatusEnum.COMPLETED;
    // Event is published by the application service after persistence
}
```

## Usage in Application Service

```java
@Transactional(rollbackFor = Exception.class)
public {Business}VO complete{Business}(Long id) {
    {Business}Aggregator aggregator = {business}AggregatorBuilder.rebuildFromPersistence(id);
    String fromStatus = aggregator.getStatus().getCode();
    aggregator.complete();
    {business}Repository.saveAggregator(aggregator);
    // Publish event after successful persistence
    domainEventPublisher.publish(
        new {Business}StatusChangedEvent(aggregator.getId(), fromStatus, aggregator.getStatus().getCode())
    );
    return convertToVO(aggregator);
}
```
