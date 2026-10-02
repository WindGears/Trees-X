package com.treesx.product;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface ProductRepository extends JpaRepository<ProductEntity,String> {
    List<ProductEntity> findAllByOrderBySortOrderAsc();
}

