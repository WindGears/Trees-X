package com.treesx.product;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface CategoryRepository extends JpaRepository<CategoryEntity,Long> {
    List<CategoryEntity> findAllByOrderBySortOrderAscIdAsc();
    boolean existsByName(String name);
}
