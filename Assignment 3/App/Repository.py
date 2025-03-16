from abc import ABC, abstractmethod
from typing import List, Optional
from app.models import Customer  # Adjust the import if your models are in a different location

# Repository Interface
class BaseCustomerRepository(ABC):
    @abstractmethod
    def create(self, customer: Customer) -> Customer:
        pass

    @abstractmethod
    def get(self, customer_id: int) -> Optional[Customer]:
        pass

    @abstractmethod
    def update(self, customer_id: int, customer: Customer) -> Customer:
        pass

    @abstractmethod
    def delete(self, customer_id: int) -> bool:
        pass

    @abstractmethod
    def list(self) -> List[Customer]:
        pass

# In-Memory Repository Implementation
class InMemoryCustomerRepository(BaseCustomerRepository):
    def __init__(self):
        self.customers = {}
        self.next_id = 1

    def create(self, customer: Customer) -> Customer:
        if customer.customer_id is None:
            customer.customer_id = self.next_id
            self.next_id += 1
        if customer.customer_id in self.customers:
            raise ValueError("Customer already exists")
        self.customers[customer.customer_id] = customer
        return customer

    def get(self, customer_id: int) -> Optional[Customer]:
        return self.customers.get(customer_id)

    def update(self, customer_id: int, customer: Customer) -> Customer:
        if customer_id not in self.customers:
            raise ValueError("Customer not found")
        self.customers[customer_id] = customer
        return customer

    def delete(self, customer_id: int) -> bool:
        if customer_id in self.customers:
            del self.customers[customer_id]
            return True
        return False

    def list(self) -> List[Customer]:
        return list(self.customers.values())
